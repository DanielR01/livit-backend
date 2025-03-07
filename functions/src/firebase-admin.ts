import * as admin from 'firebase-admin';
const serviceAccount = require('../thelivitapp-firebase-adminsdk-wy62v-0e5de686ba.json') as admin.ServiceAccount;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: 'thelivitapp.appspot.com'
});

export const db = admin.firestore();
export const storage = admin.storage();
export default admin; 