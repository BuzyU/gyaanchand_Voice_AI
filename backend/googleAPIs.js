// backend/googleAPIs.js - Complete Gmail & Calendar Integration
const { google } = require('googleapis');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// OAuth2 Client Setup
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/oauth2callback'
);

// Set credentials if refresh token exists
if (process.env.GOOGLE_REFRESH_TOKEN) {
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });
}

// Gmail API Service
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// Calendar API Service
const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

/**
 * GMAIL FUNCTIONS
 */

// Send Email
async function sendEmail(to, subject, body) {
  console.log('\n📧 Gmail API: Sending email');
  console.log(`   To: ${to}`);
  console.log(`   Subject: ${subject}`);
  console.log(`   Body: ${body.substring(0, 50)}...`);

  try {
    const email = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body
    ].join('\n');

    const encodedEmail = Buffer.from(email)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedEmail
      }
    });

    console.log(`✅ Email sent successfully (ID: ${response.data.id})`);
    return {
      success: true,
      messageId: response.data.id,
      message: `Email sent to ${to} successfully.`
    };

  } catch (error) {
    console.error('❌ Gmail API Error:', error.message);
    return {
      success: false,
      error: error.message,
      message: `Failed to send email: ${error.message}`
    };
  }
}

// Get Recent Emails
async function getRecentEmails(maxResults = 5) {
  console.log(`\n📬 Gmail API: Fetching ${maxResults} recent emails`);

  try {
    const response = await gmail.users.messages.list({
      userId: 'me',
      maxResults: maxResults,
      labelIds: ['INBOX']
    });

    if (!response.data.messages || response.data.messages.length === 0) {
      console.log('⚠️ No emails found');
      return { success: true, emails: [], message: 'No emails found in inbox.' };
    }

    const emails = [];
    for (const message of response.data.messages) {
      const details = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
        format: 'metadata',
        metadataHeaders: ['From', 'Subject', 'Date']
      });

      const headers = details.data.payload.headers;
      const email = {
        id: message.id,
        from: headers.find(h => h.name === 'From')?.value || 'Unknown',
        subject: headers.find(h => h.name === 'Subject')?.value || 'No Subject',
        date: headers.find(h => h.name === 'Date')?.value || 'Unknown'
      };
      emails.push(email);
      console.log(`   📨 ${email.from}: ${email.subject}`);
    }

    console.log(`✅ Retrieved ${emails.length} emails`);
    return { success: true, emails, message: `Found ${emails.length} recent emails.` };

  } catch (error) {
    console.error('❌ Gmail API Error:', error.message);
    return { success: false, error: error.message, message: `Failed to fetch emails: ${error.message}` };
  }
}

/**
 * CALENDAR FUNCTIONS
 */

// Create Calendar Event
async function createCalendarEvent(summary, startDateTime, endDateTime, description = '', location = '') {
  console.log('\n📅 Calendar API: Creating event');
  console.log(`   Title: ${summary}`);
  console.log(`   Start: ${startDateTime}`);
  console.log(`   End: ${endDateTime}`);

  try {
    const event = {
      summary: summary,
      location: location,
      description: description,
      start: {
        dateTime: startDateTime,
        timeZone: 'Asia/Kolkata' // Change to your timezone
      },
      end: {
        dateTime: endDateTime,
        timeZone: 'Asia/Kolkata'
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 }
        ]
      }
    };

    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event
    });

    console.log(`✅ Event created (ID: ${response.data.id})`);
    return {
      success: true,
      eventId: response.data.id,
      eventLink: response.data.htmlLink,
      message: `Event "${summary}" scheduled for ${new Date(startDateTime).toLocaleString()}.`
    };

  } catch (error) {
    console.error('❌ Calendar API Error:', error.message);
    return {
      success: false,
      error: error.message,
      message: `Failed to create event: ${error.message}`
    };
  }
}

// Get Upcoming Events
async function getUpcomingEvents(maxResults = 10) {
  console.log(`\n📆 Calendar API: Fetching ${maxResults} upcoming events`);

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      maxResults: maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    });

    const events = response.data.items || [];

    if (events.length === 0) {
      console.log('⚠️ No upcoming events found');
      return { success: true, events: [], message: 'No upcoming events found.' };
    }

    console.log(`✅ Found ${events.length} upcoming events:`);
    events.forEach(event => {
      const start = event.start.dateTime || event.start.date;
      console.log(`   📅 ${event.summary} - ${new Date(start).toLocaleString()}`);
    });

    return {
      success: true,
      events: events.map(e => ({
        id: e.id,
        summary: e.summary,
        start: e.start.dateTime || e.start.date,
        end: e.end.dateTime || e.end.date,
        location: e.location,
        link: e.htmlLink
      })),
      message: `Found ${events.length} upcoming events.`
    };

  } catch (error) {
    console.error('❌ Calendar API Error:', error.message);
    return { success: false, error: error.message, message: `Failed to fetch events: ${error.message}` };
  }
}

// Delete Calendar Event
async function deleteCalendarEvent(eventId) {
  console.log(`\n🗑️ Calendar API: Deleting event ${eventId}`);

  try {
    await calendar.events.delete({
      calendarId: 'primary',
      eventId: eventId
    });

    console.log('✅ Event deleted successfully');
    return { success: true, message: 'Event deleted successfully.' };

  } catch (error) {
    console.error('❌ Calendar API Error:', error.message);
    return { success: false, error: error.message, message: `Failed to delete event: ${error.message}` };
  }
}

// Generate OAuth URL for first-time setup
function getAuthUrl() {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });
}

// Get tokens from auth code (first-time setup)
async function getTokensFromCode(code) {
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    
    console.log('✅ OAuth tokens obtained');
    console.log('🔑 Add this to your .env file:');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    
    return tokens;
  } catch (error) {
    console.error('❌ OAuth Error:', error.message);
    throw error;
  }
}

module.exports = {
  // Gmail
  sendEmail,
  getRecentEmails,
  
  // Calendar
  createCalendarEvent,
  getUpcomingEvents,
  deleteCalendarEvent,
  
  // OAuth
  getAuthUrl,
  getTokensFromCode,
  oauth2Client
};