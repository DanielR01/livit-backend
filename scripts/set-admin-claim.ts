import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin with service account
// IMPORTANT: Don't hardcode the path to your service account
const serviceAccountPath = path.resolve(__dirname, '../service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath)
});

// Function to set admin claim
async function setAdminClaim(uid: string) {
  try {
    // Get current custom claims
    const user = await admin.auth().getUser(uid);
    const currentClaims = user.customClaims || {};
    
    // Add admin claim
    await admin.auth().setCustomUserClaims(uid, {
      ...currentClaims,
      admin: true
    });
    
    console.log(`✅ Successfully set admin claim for user: ${uid}`);
    console.log(`Current claims: ${JSON.stringify(user.customClaims)}`);
    console.log(`New claims: ${JSON.stringify({...currentClaims, admin: true})}`);
  } catch (error) {
    console.error('❌ Error setting admin claim:', error);
  } finally {
    // Exit the process when done
    process.exit();
  }
}

// Get UID from command line arguments
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('❌ Please provide a user UID as a command line argument');
  process.exit(1);
}

const userUid = args[0];
console.log(`🔑 Setting admin claim for user: ${userUid}`);
setAdminClaim(userUid);