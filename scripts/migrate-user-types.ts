import * as admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.resolve(__dirname, '../service-account.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath)
});

const db = admin.firestore();

async function migrateUserTypes() {
  try {
    console.log('🔄 Starting user type migration...');
    
    // Get all users from Firestore collections
    const [customers, promoters, scanners] = await Promise.all([
      db.collection('users').where('userType', '==', 'customer').get(),
      db.collection('users').where('userType', '==', 'promoter').get(),
      db.collection('scanners').get()
    ]);
    
    console.log(`📊 Found ${customers.size} customers, ${promoters.size} promoters, ${scanners.size} scanners`);
    
    const updates = [];
    
    // Set userType for customers
    for (const doc of customers.docs) {
      const user = await admin.auth().getUser(doc.id).catch(() => null);
      if (!user) {
        console.log(`⚠️ No auth user found for customer ${doc.id}, skipping`);
        continue;
      }
      
      updates.push(
        admin.auth().setCustomUserClaims(doc.id, {
          userType: 'customer',
          // Preserve existing claims
          ...user.customClaims
        })
      );
    }
    
    // Set userType for promoters
    for (const doc of promoters.docs) {
      const user = await admin.auth().getUser(doc.id).catch(() => null);
      if (!user) {
        console.log(`⚠️ No auth user found for promoter ${doc.id}, skipping`);
        continue;
      }
      
      updates.push(
        admin.auth().setCustomUserClaims(doc.id, {
          userType: 'promoter',
          promoterId: doc.id,
          // Preserve existing claims
          ...user.customClaims
        })
      );
    }
    
    // Set userType for scanners
    for (const doc of scanners.docs) {
      const user = await admin.auth().getUser(doc.id).catch(() => null);
      if (!user) {
        console.log(`⚠️ No auth user found for scanner ${doc.id}, skipping`);
        continue;
      }
      
      updates.push(
        admin.auth().setCustomUserClaims(doc.id, {
          userType: 'scanner',
          promoterId: doc.data().promoterId,
          locationIds: doc.data().locationIds || [],
          eventIds: doc.data().eventIds || [],
          // Preserve existing claims
          ...user.customClaims
        })
      );
    }
    
    console.log(`🔄 Processing ${updates.length} user claim updates...`);
    await Promise.all(updates);
    
    console.log(`✅ Migration completed successfully! Updated ${updates.length} users.`);
  } catch (error) {
    console.error('❌ Error migrating user types:', error);
  } finally {
    process.exit();
  }
}

migrateUserTypes(); 