// backend/actionHandler.js - Gmail & Calendar integration
const { sendEmail, getRecentEmails, createCalendarEvent, getUpcomingEvents, deleteCalendarEvent } = require('./googleAPIs');

// Extract email details from natural language
function extractEmailDetails(text) {
  console.log(`📧 [EMAIL-PARSER] Analyzing: "${text}"`);
  
  let to = null;
  let subject = null;
  let body = null;

  // Extract recipient
  const toPatterns = [
    /(?:send|email|mail)\s+(?:to|my)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    /(?:to|recipient|address)[\s:]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i
  ];

  for (const pattern of toPatterns) {
    const match = text.match(pattern);
    if (match) {
      to = match[1];
      console.log(`✅ [EMAIL-PARSER] Found recipient: ${to}`);
      break;
    }
  }

  // Extract subject
  const subjectPatterns = [
    /subject[\s:]+["']?([^"']+?)["']?\s+(?:body|message|saying)/i,
    /subject[\s:]+["']?([^"']+?)["']?$/i,
    /about\s+["']?([^"']+?)["']?\s+(?:body|message)/i
  ];

  for (const pattern of subjectPatterns) {
    const match = text.match(pattern);
    if (match) {
      subject = match[1].trim();
      console.log(`✅ [EMAIL-PARSER] Found subject: ${subject}`);
      break;
    }
  }

  // Extract body
  const bodyPatterns = [
    /(?:body|message|saying|tell them|content)[\s:]+["']?(.+?)["']?$/i,
    /(?:that|says?)\s+["'](.+?)["']$/i
  ];

  for (const pattern of bodyPatterns) {
    const match = text.match(pattern);
    if (match) {
      body = match[1].trim();
      console.log(`✅ [EMAIL-PARSER] Found body: ${body.substring(0, 50)}...`);
      break;
    }
  }

  // Default values if not found
  if (!subject && body) {
    subject = body.substring(0, 50);
  } else if (!subject) {
    subject = "Message from Gyaanchand";
  }

  if (!body) {
    body = text;
  }

  console.log(`📊 [EMAIL-PARSER] Extracted - To: ${to}, Subject: ${subject}, Body length: ${body.length}`);

  return { to, subject, body };
}

// Extract calendar event details
function extractCalendarDetails(text) {
  console.log(`📅 [CALENDAR-PARSER] Analyzing: "${text}"`);
  
  let title = null;
  let date = null;
  let time = null;
  let duration = 1; // hours
  let description = '';

  // Extract title/person
  const titlePatterns = [
    /(?:book|schedule|meeting|appointment)\s+(?:with|for)\s+(?:dr\.?|doctor|mr\.?|mrs\.?|ms\.?)?\s*([a-z\s]+?)(?:\s+on|\s+for|\s+at|$)/i,
    /(?:remind|set)\s+(?:me\s+)?(?:about|for)\s+(.+?)(?:\s+on|\s+at|$)/i,
    /(?:schedule|book)\s+(.+?)(?:\s+on|\s+for|\s+at|$)/i
  ];

  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match) {
      title = match[1].trim();
      console.log(`✅ [CALENDAR-PARSER] Found title: ${title}`);
      break;
    }
  }

  // Extract date
  const datePatterns = [
    /(?:on\s+)?(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)/i,
    /(?:on\s+)?([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(tomorrow|today|next\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))/i
  ];

  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      date = match[0];
      console.log(`✅ [CALENDAR-PARSER] Found date: ${date}`);
      break;
    }
  }

  // Extract time
  const timePatterns = [
    /(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    /(?:at\s+)?(\d{1,2}):(\d{2})/
  ];

  for (const pattern of timePatterns) {
    const match = text.match(pattern);
    if (match) {
      time = match[0];
      console.log(`✅ [CALENDAR-PARSER] Found time: ${time}`);
      break;
    }
  }

  // Extract duration
  const durationMatch = text.match(/(?:for\s+)?(\d+)\s*(?:hour|hr)s?/i);
  if (durationMatch) {
    duration = parseInt(durationMatch[1]);
    console.log(`✅ [CALENDAR-PARSER] Found duration: ${duration} hour(s)`);
  }

  console.log(`📊 [CALENDAR-PARSER] Extracted - Title: ${title}, Date: ${date}, Time: ${time}, Duration: ${duration}h`);

  return { title, date, time, duration, description };
}

// Parse date string to ISO format
function parseToISODate(dateStr, timeStr = null) {
  const now = new Date();
  let targetDate = new Date();

  // Handle relative dates
  if (/tomorrow/i.test(dateStr)) {
    targetDate.setDate(now.getDate() + 1);
  } else if (/today/i.test(dateStr)) {
    // Keep today's date
  } else if (/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(dateStr)) {
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = dateStr.match(/next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i)[1].toLowerCase();
    const targetDayIndex = daysOfWeek.indexOf(targetDay);
    const currentDayIndex = now.getDay();
    const daysToAdd = (targetDayIndex + 7 - currentDayIndex) % 7 || 7;
    targetDate.setDate(now.getDate() + daysToAdd);
  } else {
    // Try to parse numeric date
    const numericMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (numericMatch) {
      const month = parseInt(numericMatch[1]) - 1;
      const day = parseInt(numericMatch[2]);
      let year = parseInt(numericMatch[3]);
      if (year < 100) year += 2000;
      targetDate = new Date(year, month, day);
    } else {
      // Try text date (e.g., "23rd December")
      const textMatch = dateStr.match(/(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+)/i);
      if (textMatch) {
        const day = parseInt(textMatch[1]);
        const monthName = textMatch[2].toLowerCase();
        const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
        const month = months.indexOf(monthName);
        if (month !== -1) {
          targetDate = new Date(now.getFullYear(), month, day);
          if (targetDate < now) {
            targetDate.setFullYear(now.getFullYear() + 1);
          }
        }
      }
    }
  }

  // Set time
  if (timeStr) {
    const timeMatch = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1]);
      const minutes = timeMatch[2] ? parseInt(timeMatch[2]) : 0;
      const meridiem = timeMatch[3] ? timeMatch[3].toLowerCase() : null;

      if (meridiem === 'pm' && hours < 12) hours += 12;
      if (meridiem === 'am' && hours === 12) hours = 0;

      targetDate.setHours(hours, minutes, 0, 0);
    }
  } else {
    // Default to 10 AM if no time specified
    targetDate.setHours(10, 0, 0, 0);
  }

  return targetDate.toISOString();
}

// Handle actions
async function handleAction(text, userText) {
  const lowerText = text.toLowerCase();

  // Email action
  if (/send|email|mail/i.test(lowerText)) {
    console.log(`\n📧 [ACTION-HANDLER] Email action detected`);
    
    const details = extractEmailDetails(userText);

    if (!details.to) {
      return {
        requiresInfo: true,
        message: "I'd be happy to send an email. Could you provide the recipient's email address?"
      };
    }

    try {
      console.log(`📤 [ACTION-HANDLER] Sending email to ${details.to}`);
      const result = await sendEmail(details.to, details.subject, details.body);
      
      if (result.success) {
        return {
          success: true,
          message: `Email sent successfully to ${details.to} with subject "${details.subject}".`
        };
      } else {
        return {
          success: false,
          message: `Sorry, I couldn't send the email. Error: ${result.error}`
        };
      }
    } catch (error) {
      console.error(`❌ [ACTION-ERROR] Email failed: ${error.message}`);
      return {
        success: false,
        message: "Sorry, I encountered an error sending the email. Please try again."
      };
    }
  }

  // Calendar action
  if (/schedule|book|calendar|meeting|appointment|remind|set.*date/i.test(lowerText)) {
    console.log(`\n📅 [ACTION-HANDLER] Calendar action detected`);
    
    const details = extractCalendarDetails(userText);

    if (!details.title) {
      return {
        requiresInfo: true,
        message: "I can help schedule that. What should I call this event?"
      };
    }

    if (!details.date) {
      return {
        requiresInfo: true,
        message: `Got it. When would you like to schedule "${details.title}"?`
      };
    }

    try {
      const startDateTime = parseToISODate(details.date, details.time);
      const endDate = new Date(startDateTime);
      endDate.setHours(endDate.getHours() + details.duration);
      const endDateTime = endDate.toISOString();

      console.log(`📅 [ACTION-HANDLER] Creating calendar event: ${details.title}`);
      console.log(`   Start: ${startDateTime}`);
      console.log(`   End: ${endDateTime}`);

      const result = await createCalendarEvent(
        details.title,
        startDateTime,
        endDateTime,
        details.description
      );

      if (result.success) {
        const dateStr = new Date(startDateTime).toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        return {
          success: true,
          message: `Event "${details.title}" scheduled for ${dateStr}. I've added it to your calendar.`
        };
      } else {
        return {
          success: false,
          message: `Sorry, I couldn't create the calendar event. Error: ${result.error}`
        };
      }
    } catch (error) {
      console.error(`❌ [ACTION-ERROR] Calendar failed: ${error.message}`);
      return {
        success: false,
        message: "Sorry, I encountered an error creating the calendar event. Please try again."
      };
    }
  }

  return null;
}

module.exports = { handleAction, extractEmailDetails, extractCalendarDetails };