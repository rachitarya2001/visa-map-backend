const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxLength: [50, 'First name cannot exceed 50 characters']
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxLength: [50, 'Last name cannot exceed 50 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  mobile: {
    type: String,
    required: [true, 'Mobile number is required'],
    trim: true,
    match: [/^[0-9]{7,15}$/, 'Please enter a valid mobile number']
  },
  dialingCode: {
    type: String,
    required: [true, 'Dialing code is required'],
    trim: true,
    match: [/^\+\d{1,4}$/, 'Please enter a valid dialing code (e.g., +91)']
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  isMobileVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: {
    type: String,
    select: false
  },
  emailVerificationExpires: {
    type: Date,
    select: false
  },
  mobileVerificationOTP: {
    type: String,
    select: false
  },
  mobileVerificationExpires: {
    type: Date,
    select: false
  },
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  role: {
    type: String,
    enum: ['user', 'admin'],
    default: 'user'
  },
  profilePicture: {
    type: String,
    default: null
  },
  preferences: {
    language: {
      type: String,
      default: 'en'
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      },
    }
  },

  loginOTP: {
    type: String,
    select: false
  },
  loginOTPExpires: {
    type: Date,
    select: false
  },
  metadata: {
    registrationIP: String,
    lastLoginIP: String,
    userAgent: String,
    referralSource: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
userSchema.index({ email: 1 });
userSchema.index({ mobile: 1, dialingCode: 1 });
userSchema.index({ status: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for full name
userSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for account lock status
userSchema.virtual('isLocked').get(function () {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});



// Pre-save middleware to handle email changes
userSchema.pre('save', function (next) {
  // If email is modified, mark as unverified
  if (this.isModified('email') && !this.isNew) {
    this.isEmailVerified = false;
    this.emailVerificationToken = undefined;
    this.emailVerificationExpires = undefined;
  }
  next();
});

// Instance method to generate login OTP
userSchema.methods.generateLoginOTP = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  this.loginOTP = crypto.createHash('sha256').update(otp).digest('hex');
  this.loginOTPExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return otp;
};

// Instance method to verify login OTP
userSchema.methods.verifyLoginOTP = function (candidateOTP) {
  if (!this.loginOTP || !this.loginOTPExpires) return false;
  if (Date.now() > this.loginOTPExpires) return false;

  const hashedOTP = crypto.createHash('sha256').update(candidateOTP).digest('hex');
  return hashedOTP === this.loginOTP;
};

// Instance method to generate email verification token
userSchema.methods.generateEmailVerificationToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.emailVerificationToken = crypto.createHash('sha256').update(token).digest('hex');
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
  return token;
};

// Instance method to generate mobile OTP
userSchema.methods.generateMobileOTP = function () {
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit OTP
  this.mobileVerificationOTP = crypto.createHash('sha256').update(otp).digest('hex');
  this.mobileVerificationExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
  return otp;
};

// Instance method to generate password reset token
userSchema.methods.generatePasswordResetToken = function () {
  const token = crypto.randomBytes(32).toString('hex');
  this.resetPasswordToken = crypto.createHash('sha256').update(token).digest('hex');
  this.resetPasswordExpires = Date.now() + 15 * 60 * 1000; // 15 minutes
  return token;
};

// Instance method to handle failed login attempts
userSchema.methods.incLoginAttempts = function () {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: { lockUntil: 1 },
      $set: { loginAttempts: 1 }
    });
  }

  const updates = { $inc: { loginAttempts: 1 } };

  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }

  return this.updateOne(updates);
};

// Instance method to reset login attempts
userSchema.methods.resetLoginAttempts = function () {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    }
  });
};

// Static method to find user for authentication
userSchema.statics.findForAuthentication = function (email) {
  return this.findOne({
    email: email.toLowerCase(),
    status: 'active'
  }).select('+password +loginAttempts +lockUntil');
};

// Static method to verify email token
userSchema.statics.findByEmailVerificationToken = function (token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() }
  });
};

// Static method to verify mobile OTP
userSchema.statics.findByMobileOTP = function (otp, mobile, dialingCode) {
  const hashedOTP = crypto.createHash('sha256').update(otp).digest('hex');
  return this.findOne({
    mobile,
    dialingCode,
    mobileVerificationOTP: hashedOTP,
    mobileVerificationExpires: { $gt: Date.now() }
  });
};

// Static method to find by password reset token
userSchema.statics.findByPasswordResetToken = function (token) {
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  return this.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: Date.now() }
  });
};

// Remove sensitive fields from JSON output
userSchema.methods.toJSON = function () {
  const userObject = this.toObject();
  delete userObject.password;
  delete userObject.emailVerificationToken;
  delete userObject.emailVerificationExpires;
  delete userObject.mobileVerificationOTP;
  delete userObject.mobileVerificationExpires;
  delete userObject.resetPasswordToken;
  delete userObject.resetPasswordExpires;
  delete userObject.loginAttempts;
  delete userObject.lockUntil;
  return userObject;
};

module.exports = mongoose.model('User', userSchema);