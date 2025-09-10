const User = require('../models/User');
const { AppError, catchAsync } = require('../middleware/errorHandler');
const { generateTokens } = require('../middleware/auth');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const logger = require('../utils/logger');
const crypto = require('crypto');

/**
 * Register a new user
 */
const register = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email, mobile, dialingCode, password } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [
      { email: email.toLowerCase() },
      { mobile: mobile, dialingCode: dialingCode }
    ]
  });

  if (existingUser) {
    if (existingUser.email === email.toLowerCase()) {
      return next(new AppError('Email already registered', 400));
    }
    if (existingUser.mobile === mobile && existingUser.dialingCode === dialingCode) {
      return next(new AppError('Mobile number already registered', 400));
    }
  }

  // Create new user
  const user = await User.create({
    firstName,
    lastName,
    email: email.toLowerCase(),
    mobile,
    dialingCode,
    password,
    metadata: {
      registrationIP: req.ip,
      userAgent: req.get('User-Agent'),
      referralSource: req.headers.referer || 'direct'
    }
  });

  // Generate email verification token
  const emailToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Send verification email
  try {
    await emailService.sendEmailVerification(user.email, user.firstName, emailToken);
    logger.logAPI('Email Verification Sent', user._id, { email: user.email });
  } catch (error) {
    logger.logError(error, req, 'Email Verification Failed');
    // Don't fail registration if email fails
  }

  // Generate tokens
  const tokens = generateTokens(user._id);

  logger.logAPI('User Registered', user._id, {
    email: user.email,
    mobile: `${user.dialingCode}${user.mobile}`
  });

  res.status(201).json({
    status: 'success',
    message: 'Registration successful. Please verify your email.',
    data: {
      user: user.toJSON(),
      ...tokens
    }
  });
});

/**
 * Login user
 */
/**
 * Login user (redirect to OTP-based login)
 */
const login = catchAsync(async (req, res, next) => {
  return next(new AppError('Please use OTP-based login. Send OTP to your email first.', 400));
});

/**
 * Logout user
 */
const logout = catchAsync(async (req, res, next) => {
  // In a stateless JWT setup, logout is handled on the client side
  // But we can log the action for security purposes
  logger.logAPI('User Logout', req.userId, {
    ip: req.ip
  });

  res.status(200).json({
    status: 'success',
    message: 'Logout successful'
  });
});

/**
 * Send email verification
 */
const sendEmailVerification = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.userId);

  if (user.isEmailVerified) {
    return next(new AppError('Email is already verified', 400));
  }

  // Generate new verification token
  const emailToken = user.generateEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // Send verification email
  try {
    await emailService.sendEmailVerification(user.email, user.firstName, emailToken);

    logger.logAPI('Email Verification Resent', user._id, { email: user.email });

    res.status(200).json({
      status: 'success',
      message: 'Verification email sent successfully'
    });
  } catch (error) {
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.logError(error, req, 'Email Service Failed');
    return next(new AppError('Failed to send verification email. Please try again later.', 500));
  }
});

/**
 * Verify email
 */
const verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  const user = await User.findByEmailVerificationToken(token);

  if (!user) {
    return next(new AppError('Invalid or expired verification token', 400));
  }

  // Mark email as verified
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.logAPI('Email Verified', user._id, { email: user.email });

  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully',
    data: {
      user: user.toJSON()
    }
  });
});

/**
 * Send mobile OTP
 */
const sendMobileOTP = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.userId);

  if (user.isMobileVerified) {
    return next(new AppError('Mobile number is already verified', 400));
  }

  // Generate OTP
  const otp = user.generateMobileOTP();
  await user.save({ validateBeforeSave: false });

  // Send OTP via SMS
  try {
    await smsService.sendOTP(`${user.dialingCode}${user.mobile}`, otp);

    logger.logAPI('Mobile OTP Sent', user._id, {
      mobile: `${user.dialingCode}${user.mobile}`
    });

    res.status(200).json({
      status: 'success',
      message: 'OTP sent to your mobile number successfully'
    });
  } catch (error) {
    user.mobileVerificationOTP = undefined;
    user.mobileVerificationExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.logError(error, req, 'SMS Service Failed');
    return next(new AppError('Failed to send OTP. Please try again later.', 500));
  }
});

/**
 * Verify mobile OTP
 */
const verifyMobileOTP = catchAsync(async (req, res, next) => {
  const { otp } = req.body;
  const user = await User.findById(req.userId);

  const userWithOTP = await User.findByMobileOTP(otp, user.mobile, user.dialingCode);

  if (!userWithOTP || userWithOTP._id.toString() !== user._id.toString()) {
    return next(new AppError('Invalid or expired OTP', 400));
  }

  // Mark mobile as verified
  user.isMobileVerified = true;
  user.mobileVerificationOTP = undefined;
  user.mobileVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.logAPI('Mobile Verified', user._id, {
    mobile: `${user.dialingCode}${user.mobile}`
  });

  res.status(200).json({
    status: 'success',
    message: 'Mobile number verified successfully',
    data: {
      user: user.toJSON()
    }
  });
});

/**
 * Forgot password
 */
const forgotPassword = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({
    email: email.toLowerCase(),
    status: 'active'
  });

  if (!user) {
    // Don't reveal if email exists for security
    return res.status(200).json({
      status: 'success',
      message: 'If the email exists, a password reset link has been sent'
    });
  }

  // Generate reset token
  const resetToken = user.generatePasswordResetToken();
  await user.save({ validateBeforeSave: false });

  // Send password reset email
  try {
    await emailService.sendPasswordReset(user.email, user.firstName, resetToken);

    logger.logAPI('Password Reset Requested', user._id, { email: user.email });

    res.status(200).json({
      status: 'success',
      message: 'Password reset link sent to your email'
    });
  } catch (error) {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.logError(error, req, 'Password Reset Email Failed');
    return next(new AppError('Failed to send reset email. Please try again later.', 500));
  }
});

/**
 * Reset password
 */
const resetPassword = catchAsync(async (req, res, next) => {
  const { token } = req.params;
  const { password } = req.body;

  const user = await User.findByPasswordResetToken(token);

  if (!user) {
    return next(new AppError('Invalid or expired reset token', 400));
  }

  // Update password
  user.password = password;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;

  // Reset login attempts
  user.loginAttempts = undefined;
  user.lockUntil = undefined;

  await user.save();

  // Generate new tokens
  const tokens = generateTokens(user._id);

  logger.logAPI('Password Reset Completed', user._id);

  res.status(200).json({
    status: 'success',
    message: 'Password reset successful',
    data: {
      user: user.toJSON(),
      ...tokens
    }
  });
});

/**
 * Change password (for authenticated users)
 */
const changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  // Get user with password
  const user = await User.findById(req.userId).select('+password');

  // Check current password
  if (!(await user.comparePassword(currentPassword))) {
    return next(new AppError('Current password is incorrect', 400));
  }

  // Update password
  user.password = newPassword;
  await user.save();

  logger.logAPI('Password Changed', user._id);

  res.status(200).json({
    status: 'success',
    message: 'Password changed successfully'
  });
});

/**
 * Get current user profile
 */
const getProfile = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.userId);

  res.status(200).json({
    status: 'success',
    data: {
      user: user.toJSON()
    }
  });
});

/**
 * Send registration OTP
 */
const sendRegistrationOTP = catchAsync(async (req, res, next) => {
  const { firstName, lastName, email, mobile, dialingCode } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({
    $or: [
      { email: email.toLowerCase() },
      { mobile: mobile, dialingCode: dialingCode }
    ]
  });

  if (existingUser) {
    if (existingUser.email === email.toLowerCase()) {
      return next(new AppError('Email already registered', 400));
    }
    if (existingUser.mobile === mobile && existingUser.dialingCode === dialingCode) {
      return next(new AppError('Mobile number already registered', 400));
    }
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000).toString();

  // Store temporary registration data with OTP (expires in 10 minutes)
  const tempData = {
    firstName,
    lastName,
    email: email.toLowerCase(),
    mobile,
    dialingCode,
    otp: crypto.createHash('sha256').update(otp).digest('hex'),
    otpExpires: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0
  };

  // Store in memory or temporary collection (you can use Redis for production)
  global.tempRegistrations = global.tempRegistrations || {};
  global.tempRegistrations[email.toLowerCase()] = tempData;

  // Send OTP email
  try {
    await emailService.sendRegistrationOTP(email, firstName, otp);

    logger.logAPI('Registration OTP Sent', null, { email: email });

    res.status(200).json({
      status: 'success',
      message: 'OTP sent to your email successfully. Please check your inbox.',
      data: {
        email: email,
        expiresIn: 600 // 10 minutes in seconds
      }
    });
  } catch (error) {
    // Remove temp data if email fails
    delete global.tempRegistrations[email.toLowerCase()];

    logger.logError(error, req, 'Registration OTP Email Failed');
    return next(new AppError('Failed to send OTP. Please try again later.', 500));
  }
});

/**
 * Verify registration OTP and complete registration
 */
const verifyRegistrationOTP = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body; // Remove password from here

  // Get temporary registration data
  const tempData = global.tempRegistrations?.[email.toLowerCase()];

  if (!tempData) {
    return next(new AppError('OTP expired or invalid. Please request a new OTP.', 400));
  }

  // Check if OTP is expired
  if (Date.now() > tempData.otpExpires) {
    delete global.tempRegistrations[email.toLowerCase()];
    return next(new AppError('OTP has expired. Please request a new OTP.', 400));
  }

  // Check attempts limit
  if (tempData.attempts >= 3) {
    delete global.tempRegistrations[email.toLowerCase()];
    return next(new AppError('Too many failed attempts. Please request a new OTP.', 400));
  }

  // Verify OTP
  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
  if (hashedOTP !== tempData.otp) {
    tempData.attempts += 1;
    return next(new AppError(`Invalid OTP. ${3 - tempData.attempts} attempts remaining.`, 400));
  }

  // OTP is valid, create user WITHOUT password
  const user = await User.create({
    firstName: tempData.firstName,
    lastName: tempData.lastName,
    email: tempData.email,
    mobile: tempData.mobile,
    dialingCode: tempData.dialingCode,
    // Remove password field completely
    isEmailVerified: true, // Email is verified via OTP
    metadata: {
      registrationIP: req.ip,
      userAgent: req.get('User-Agent'),
      referralSource: req.headers.referer || 'direct'
    }
  });

  // Clean up temporary data
  delete global.tempRegistrations[email.toLowerCase()];

  // Generate tokens
  const tokens = generateTokens(user._id);

  logger.logAPI('User Registered via OTP', user._id, {
    email: user.email,
    mobile: `${user.dialingCode}${user.mobile}`
  });

  res.status(201).json({
    status: 'success',
    message: 'Registration completed successfully!',
    data: {
      user: user.toJSON(),
      ...tokens
    }
  });
});

/**
 * Send login OTP
 */
const sendLoginOTP = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  // Check if user exists
  const user = await User.findOne({ email: email.toLowerCase() });

  if (!user) {
    return next(new AppError('No account found with this email address', 404));
  }

  // Generate login OTP
  const otp = user.generateLoginOTP();
  await user.save({ validateBeforeSave: false });

  // Send OTP email
  try {
    await emailService.sendLoginOTP(email, user.firstName, otp);

    logger.logAPI('Login OTP Sent', user._id, { email: email });

    res.status(200).json({
      status: 'success',
      message: 'OTP sent to your email successfully.',
      data: {
        email: email,
        expiresIn: 600 // 10 minutes in seconds
      }
    });
  } catch (error) {
    // Clear OTP if email fails
    user.loginOTP = undefined;
    user.loginOTPExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.logError(error, req, 'Login OTP Email Failed');
    return next(new AppError('Failed to send OTP. Please try again later.', 500));
  }
});

/**
 * Verify login OTP and login user
 */
const verifyLoginOTP = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;

  // Find user and include OTP fields
  const user = await User.findOne({
    email: email.toLowerCase()
  }).select('+loginOTP +loginOTPExpires');

  if (!user) {
    return next(new AppError('No account found with this email address', 404));
  }

  // Verify OTP
  if (!user.verifyLoginOTP(otp)) {
    return next(new AppError('Invalid or expired OTP', 400));
  }

  // Clear OTP fields
  user.loginOTP = undefined;
  user.loginOTPExpires = undefined;

  // Update last login
  user.lastLogin = new Date();
  user.metadata.lastLoginIP = req.ip;
  user.metadata.userAgent = req.get('User-Agent');
  await user.save({ validateBeforeSave: false });

  // Generate tokens
  const tokens = generateTokens(user._id);

  logger.logAPI('User Login via OTP', user._id, {
    email: user.email,
    ip: req.ip
  });

  res.status(200).json({
    status: 'success',
    message: 'Login successful',
    data: {
      user: user.toJSON(),
      ...tokens
    }
  });
});

module.exports = {
  register,
  login,
  logout,
  sendEmailVerification,
  verifyEmail,
  sendMobileOTP,
  verifyMobileOTP,
  forgotPassword,
  resetPassword,
  changePassword,
  getProfile,
  sendRegistrationOTP,
  verifyRegistrationOTP,
  sendLoginOTP,
  verifyLoginOTP
};