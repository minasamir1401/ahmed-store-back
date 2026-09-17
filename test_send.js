require('dotenv').config();
const { sendTestEmail } = require('./src/services/emailService');

const targetEmail = process.argv[2] || 'mina15g4y@gmail.com';

async function main() {
  console.log(`Testing Resend email service to: ${targetEmail}`);
  try {
    const settings = {
      resend_api_key: process.env.RESEND_API_KEY || '',
      from_email: process.env.RESEND_FROM_EMAIL || 'orders@the-vitahub.com',
      from_name: 'The VitaHub'
    };
    const res = await sendTestEmail(settings, targetEmail);
    console.log('Email sent successfully via Resend:', res);
  } catch (err) {
    console.error('Resend send failed:', err.message);
  }
}

main();
