const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

// Create transporter
const createTransporter = () => {
  // Use AWS SES SMTP configuration
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'email-smtp.ap-south-1.amazonaws.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};
/**
 * Send email verification
 */
const sendEmailVerification = async (email, firstName, token) => {
  try {
    const transporter = createTransporter();

    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email/${token}`;

    const mailOptions = {
      from: process.env.EMAIL_SENDER || 'support@foreignadmits.com', // Use your verified SES email
      to: email,
      subject: 'Your Registration OTP - VisaMonk',
      html: `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
      <h2>Welcome ${firstName}!</h2>
      <p>Your OTP for registration is: <strong style="font-size: 24px; color: #4F46E5;">${otp}</strong></p>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    </div>
  `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Email verification sent to: ${email}`);

  } catch (error) {
    logger.error('Email verification send failed:', error);
    throw error;
  }
};

/**
 * Send password reset email
 */
const sendPasswordReset = async (email, firstName, token) => {
  try {
    const transporter = createTransporter();

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${token}`;

    const mailOptions = {
      from: process.env.EMAIL_SENDER || 'support@foreignadmits.com', // Use your verified SES email
      to: email,
      subject: 'Your Registration OTP - VisaMonk',
      html: `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
      <h2>Welcome ${firstName}!</h2>
      <p>Your OTP for registration is: <strong style="font-size: 24px; color: #4F46E5;">${otp}</strong></p>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    </div>
  `
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Password reset email sent to: ${email}`);

  } catch (error) {
    logger.error('Password reset email send failed:', error);
    throw error;
  }
};

/**
 * Send registration OTP
 */
const sendRegistrationOTP = async (email, firstName, otp) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.EMAIL_SENDER || 'support@foreignadmits.com', // Use your verified SES email
      to: email,
      subject: 'Your Registration OTP - VisaMonk',
      html: `
    <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
      <h2>Welcome ${firstName}!</h2>
      <p>Your OTP for registration is: <strong style="font-size: 24px; color: #4F46E5;">${otp}</strong></p>
      <p>This OTP will expire in 10 minutes.</p>
      <p>If you didn't request this, please ignore this email.</p>
    </div>
  `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending registration OTP:', error);
    throw error;
  }
};

/**
 * Send login OTP
 */
const sendLoginOTP = async (email, firstName, otp) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: process.env.EMAIL_SENDER || 'support@foreignadmits.com',
      to: email,
      subject: 'Your Login OTP - VisaMonk',
      html: `
        <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center;">
            <h1 style="color: white; margin: 0;">VisaMonk</h1>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">Welcome back, ${firstName}!</h2>
            
            <p style="color: #666; font-size: 16px; line-height: 1.5;">
              You requested to login to your VisaMonk account. Use the OTP below to continue:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <div style="background: white; border: 2px dashed #667eea; border-radius: 10px; padding: 20px; display: inline-block;">
                <span style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 5px;">${otp}</span>
              </div>
            </div>
            
            <p style="color: #666; font-size: 14px; text-align: center;">
              This OTP will expire in <strong>10 minutes</strong>
            </p>
            
            <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 5px; padding: 15px; margin: 20px 0;">
              <p style="color: #856404; margin: 0; font-size: 14px;">
                <strong>Security Note:</strong> If you didn't request this login, please ignore this email or contact support.
              </p>
            </div>
          </div>
          
          <div style="background: #333; padding: 20px; text-align: center;">
            <p style="color: #999; margin: 0; font-size: 12px;">
              VisaMonk - Your trusted visa guidance partner
            </p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('Error sending login OTP:', error);
    throw error;
  }
};

module.exports = {
  sendEmailVerification,
  sendPasswordReset,
  sendRegistrationOTP,
  sendLoginOTP
};