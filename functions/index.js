const functions = require('firebase-functions');
const admin = require('firebase-admin');
const stripe = require('stripe');
const cors = require('cors')({ origin: true });

admin.initializeApp();
const db = admin.firestore();

// ── Create Stripe Checkout Session ──
// Called by the resident app when they choose "Stripe (card)" to pay rent.
exports.createCheckoutSession = functions.https.onRequest((req, res) => {
  cors(req, res, async () => {
    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const stripeClient = stripe(functions.config().stripe.secret_key);
      const { amount, userId, userName, email } = req.body;

      if (!amount || !userId) {
        res.status(400).json({ error: 'Missing amount or userId' });
        return;
      }

      // Get the house settings for the success/cancel URLs
      const houseDoc = await db.collection('house').doc('settings').get();
      const houseData = houseDoc.exists ? houseDoc.data() : {};
      const baseUrl = houseData.appUrl || 'https://app.dalyrecovery.org';

      const session = await stripeClient.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: email || undefined,
        metadata: {
          userId,
          userName: userName || '',
          type: 'rent'
        },
        line_items: [{
          price_data: {
            currency: 'usd',
            unit_amount: amount, // in cents
            product_data: {
              name: 'Daly Recovery — Rent Payment',
              description: `Rent payment from ${userName || 'Resident'}`,
            },
          },
          quantity: 1,
        }],
        success_url: `${baseUrl}/?payment=success`,
        cancel_url: `${baseUrl}/?payment=cancelled`,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (error) {
      console.error('Stripe error:', error);
      res.status(500).json({ error: error.message });
    }
  });
});

// ── Stripe Webhook — handles successful payments ──
// Set up in Stripe Dashboard → Webhooks → Add endpoint
// URL: https://us-central1-YOUR_PROJECT.cloudfunctions.net/stripeWebhook
// Events: checkout.session.completed
exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const stripeClient = stripe(functions.config().stripe.secret_key);
  const endpointSecret = functions.config().stripe.webhook_secret;

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripeClient.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { userId, userName } = session.metadata;
    const amountPaid = session.amount_total / 100; // convert from cents

    if (userId) {
      try {
        // Record the payment
        await db.collection('payments').add({
          userId,
          userName: userName || '',
          amount: amountPaid,
          method: 'Stripe',
          status: 'confirmed',
          stripeSessionId: session.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        // Update resident balance
        await db.collection('users').doc(userId).update({
          balance: admin.firestore.FieldValue.increment(-amountPaid)
        });

        // Log activity
        await db.collection('activity').add({
          text: `${userName || 'Resident'} paid $${amountPaid} rent (Stripe).`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          userId
        });

        console.log(`Payment recorded: $${amountPaid} from ${userName} (${userId})`);
      } catch (err) {
        console.error('Error recording payment:', err);
      }
    }
  }

  res.json({ received: true });
});

// ── Weekly rent charge — runs every Monday at 6 AM UTC ──
// Adds the weekly rent to every active resident's balance
exports.weeklyRentCharge = functions.pubsub
  .schedule('0 6 * * 1') // Monday 6 AM UTC (midnight MDT)
  .timeZone('America/Denver')
  .onRun(async () => {
    const houseDoc = await db.collection('house').doc('settings').get();
    const rent = houseDoc.exists ? (houseDoc.data().weeklyRent || 185) : 185;

    const residentsSnap = await db.collection('users')
      .where('role', '==', 'resident')
      .where('active', '==', true)
      .get();

    const batch = db.batch();
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    residentsSnap.docs.forEach(doc => {
      batch.update(doc.ref, {
        balance: admin.firestore.FieldValue.increment(rent),
        paidThrough: dateStr
      });
    });

    await batch.commit();

    await db.collection('activity').add({
      text: `Weekly rent ($${rent}) charged to ${residentsSnap.size} residents.`,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      userId: 'system'
    });

    console.log(`Charged $${rent} to ${residentsSnap.size} residents`);
  });

// ── Weekly meetings reset — runs every Monday at 5 AM UTC ──
// Resets all residents' meeting counts to 0
exports.weeklyMeetingsReset = functions.pubsub
  .schedule('0 5 * * 1')
  .timeZone('America/Denver')
  .onRun(async () => {
    const residentsSnap = await db.collection('users')
      .where('role', '==', 'resident')
      .where('active', '==', true)
      .get();

    const batch = db.batch();
    residentsSnap.docs.forEach(doc => {
      batch.update(doc.ref, { meetings: 0 });
    });
    await batch.commit();
    console.log(`Reset meetings for ${residentsSnap.size} residents`);
  });
