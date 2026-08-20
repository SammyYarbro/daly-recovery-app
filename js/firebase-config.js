// Firebase configuration — replace with your project's values
// Get these from: Firebase Console → Project Settings → Your Apps → Web App
const firebaseConfig = {
  apiKey: "AIzaSyAHPgSKoSXzYqwyHPxoszNq99v4YW6FkTw",
  authDomain: "daly-recovery-connect.firebaseapp.com",
  projectId: "daly-recovery-connect",
  storageBucket: "daly-recovery-connect.firebasestorage.app",
  messagingSenderId: "831701755305",
  appId: "1:831701755305:web:0b33353db4f832dc3510b8"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);

// Services
const auth = firebase.auth();
const db = firebase.firestore();

// Enable offline persistence
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence failed: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence not available in this browser');
  }
});

// Stripe config — replace with your publishable key
const STRIPE_PUBLISHABLE_KEY = "YOUR_STRIPE_PUBLISHABLE_KEY";
// Your Cloud Function / Worker URL for creating checkout sessions
const STRIPE_CHECKOUT_URL = "YOUR_CLOUD_FUNCTION_URL/createCheckoutSession";
