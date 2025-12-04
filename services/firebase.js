import admin from "firebase-admin"
import serviceAccont from '../firebase-service-account-key.json' with { type: "json" };
import { getDateKey } from "../utils/date.js";
import dotenv from 'dotenv'

dotenv.config()

admin.initializeApp({
  credential: admin.credential.cert(serviceAccont),
  databaseURL: process.env.DATABASE_URL,
});

export const db = admin.database();

const dbf = admin.firestore()
const fcm = admin.messaging()

export const saveToFirebase = async (path, data) => {
  try {
    await db.ref(path).set(data);
  } catch (error) {
    console.error(`Error saving to Firebase ${path}:`, error);
  }
};

export const saveToFirebaseHistory = async (path, data) => {
  try {
    const now = new Date();
    const historyEntry = {
      ...data,
      id: `${Date.now()}_${now.getMilliseconds()}`,
      recorded_at: now.toISOString(),
      date_key: getDateKey(now),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };

    await db.ref(path).push(historyEntry);
    console.log(`History data saved to Firebase: ${path}`);
  } catch (error) {
    console.error(`Error saving history to Firebase ${path}:`, error);
  }
};

export const getLatestFromFirebase = async (path) => {
  try {
    const snapshot = await db.ref(path).once("value");
    return snapshot.val();
  } catch (error) {
    console.error(`Error reading from Firebase ${path}:`, error);
    return null;
  }
};


export async function sendNotification(title, body) {
  try {
    const snapshot = await dbf.collection("devices").get();

    if (snapshot.empty) return;

    const tokens = [];
    snapshot.forEach(doc => tokens.push(doc.id));

    const message = {
      notification: {
        title: title,
        body: body,
      },

      // ANDROID
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "default",
        },
      },

      // iOS
      apns: {
        payload: {
          aps: {
            sound: "default",       
            alert: {
              title: title,
              body: body,
            },
          },
        },
        headers: {
          "apns-priority": "10",  
        },
      },

      tokens: tokens,
    };

    const response = await fcm.sendEachForMulticast(message);

    return response;
  } catch (err) {
    console.error("Error sending notification:", err);
  }
}