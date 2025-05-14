import express from 'express';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import axios from 'axios';
import { createRequire } from 'module';
import { API_ENDPOINTS } from './api.js';

// Load environment variables
dotenv.config();
const require = createRequire(import.meta.url);
const serviceAccount = require('./service.json');

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const PORT = process.env.PORT || 3000;

// ───────────────────────────────────────────────
// Utility Functions
// ───────────────────────────────────────────────

// Fetch all FCM tokens from external API
const fetchAllFCMTokens = async () => {
  try {
    const { data } = await axios.get(
      'https://devcrm20.abacasys.com/ords/canwinn/mobile_api/get_fcm_token'
    );
    return data.data || [];
  } catch (error) {
    console.error('❌ Error fetching FCM tokens:', error.message);
    return [];
  }
};

// Send Notification to a specific FCM token
const sendNotification = async (token, title, body) => {
  if (!token) throw new Error('FCM token is required');

  const payload = {
    token,
    notification: { title, body },
    data: {
      type: 'notification',
      title,
      body,
    },
  };

  try {
    return await admin.messaging().send(payload);
  } catch (error) {
    console.error(`❌ Failed to send notification to token ${token}:`, error.message);
    throw error;
  }
};

// Send data to external notification API
const HandleExternalNotification = async (title, message, user_id) => {
  try {
    console.log('External notification request:', {
      title,
      message,
      user_id,
    });
    const response = await axios.post(API_ENDPOINTS.NOTIFICATION, {
      title : title,
      message : message,
      user_id : user_id,
    });

    console.log('✅ External notification response:', response.data);
  } catch (error) {
    console.error('❌ Error sending external notification:', error.message);
  }
};

// ───────────────────────────────────────────────
// Broadcast Notification Endpoints
// ───────────────────────────────────────────────

const handleBroadcastNotification = async (res, type, title, body) => {
  try {
    const tokens = (await fetchAllFCMTokens()).map(token => token.fcm_token);
    const results = { success: 0, failure: 0 };

    const batch = tokens.map(token =>
      sendNotification(token, title, body)
        .then(() => results.success++)
        .catch(() => results.failure++)
    );

    await Promise.allSettled(batch);

    console.log(`✅ ${type} notification sent to ${results.success} devices, failed for ${results.failure} devices`);

    res.status(200).json({
      message: `${type} notifications processed`,
      successCount: results.success,
      failureCount: results.failure,
    });
  } catch (error) {
    console.error(`❌ Error in ${type.toLowerCase()} broadcast:`, error.message);
    res.status(500).json({ error: 'Failed to process notifications' });
  }
};

app.post('/notify/alert', (req, res) => {
  handleBroadcastNotification(res, 'Alert', 'Alert', 'Your application has been submitted successfully.');
});

app.post('/notify/promotional', (req, res) => {
  handleBroadcastNotification(res, 'Promotional', 'Promotional', 'Your application has been submitted successfully.');
});

// ───────────────────────────────────────────────
// Single Notification Endpoints
// ───────────────────────────────────────────────

const singleNotificationHandler = async (req, res, title, defaultMessage) => {

  console.log('Single notification request:', req.body);

  const { fcm_token, message, user_id } = req.body;



  if (!fcm_token) {
    return res.status(400).json({ error: 'FCM token is required' });
  }

  try {
    const result = await sendNotification(fcm_token, title, message || defaultMessage);
    await HandleExternalNotification(title, message || defaultMessage, user_id);

    console.log(`✅ ${title} notification sent`);
    res.status(200).json({
      message: 'Notification sent successfully',
      messageId: result,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send notification' });
  }
};

// Routes using the handler
app.post('/notify/application_status', (req, res) =>
  singleNotificationHandler(req, res, 'Application Update', 'Your application at ABC Corp is under review.')
);

app.post('/notify/job-alert', (req, res) =>
  singleNotificationHandler(req, res, 'New Job Matching Your Profile!', 'Check out 5 new jobs matching your skills!')
);

app.post('/notify/profile-viewed', (req, res) =>
  singleNotificationHandler(req, res, 'Your Profile was Viewed', req.body.message)
);

app.post('/notify/interview-reminder', (req, res) =>
  singleNotificationHandler(req, res, 'Interview Reminder', req.body.message)
);

app.post('/notify/offer-letter', (req, res) =>
  singleNotificationHandler(req, res, 'Offer Letter Received', "Congratulations! You've received an offer.")
);

// ───────────────────────────────────────────────
// Error Handling Middleware
// ───────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ───────────────────────────────────────────────
// Start Server
// ───────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
