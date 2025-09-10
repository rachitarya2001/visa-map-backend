const Journey = require('../models/Journey');
const User = require('../models/User');
const Country = require('../models/Country');
const VisaType = require('../models/VisaType');
const AppError = require('../middleware/errorHandler').AppError;
const logger = require('../utils/logger');

/**
 * Journey Controller - Fixed for multiple journeys and resume functionality
 * Integrates with frontend ProgressData interface
 */

/**
 * Create a new journey (ALWAYS create new, don't update existing)
 * POST /api/v1/journeys
 */
const createOrUpdateJourney = async (req, res, next) => {
  try {
    const {
      email,
      originCountry,
      destinationCountry,
      userType,
      visaType,
      personalizationData,
      checklist,
      stepCompletion,
      timestamps
    } = req.body;

    // Validate required fields
    if (!email || !originCountry || !destinationCountry) {
      return next(new AppError('Email, origin country, and destination country are required', 400));
    }

    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Validate countries exist
    const [origin, destination] = await Promise.all([
      Country.findOne({ code: originCountry.toUpperCase() }),
      Country.findOne({ code: destinationCountry.toUpperCase() })
    ]);

    if (!origin || !destination) {
      return next(new AppError('Invalid country codes provided', 400));
    }

    // ALWAYS CREATE NEW JOURNEY - Allow multiple journeys per user
    const journey = new Journey({
      userId: user._id,
      email,
      originCountry: originCountry.toUpperCase(),
      destinationCountry: destinationCountry.toUpperCase(),
      userType: userType || 'student',
      visaType: visaType || 'student',
      personalizationData: personalizationData || {},
      stepCompletion: new Map(Object.entries(stepCompletion || {})),
      checklist: new Map(Object.entries(checklist || {})),
      timestamps: {
        journeyStarted: new Date(),
        lastActivity: new Date(),
        ...timestamps
      },
      metadata: {
        deviceInfo: {
          userAgent: req.get('User-Agent'),
          platform: req.get('sec-ch-ua-platform'),
          isMobile: /mobile/i.test(req.get('User-Agent'))
        },
        sessionData: {
          totalSessions: 1,
          totalTimeSpent: 0,
          averageSessionTime: 0
        },
        sourceInfo: {
          referralSource: req.query.ref || 'direct',
          utmSource: req.query.utm_source,
          utmMedium: req.query.utm_medium,
          utmCampaign: req.query.utm_campaign
        }
      }
    });

    await journey.save();

    logger.info(`New journey created for user ${email}`, {
      journeyId: journey._id,
      route: `${originCountry} → ${destinationCountry}`
    });

    res.status(201).json({
      status: 'success',
      message: 'Journey created successfully',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in createOrUpdateJourney:', error);
    next(new AppError('Failed to create journey', 500));
  }
};

/**
 * Get ALL user's journeys (for dashboard)
 * GET /api/v1/journeys
 */
const getUserJourneys = async (req, res, next) => {
  try {
    const { status, limit = 50, offset = 0 } = req.query;

    let query = { userId: req.user._id };

    // If status filter is provided, use it; otherwise get all journeys
    if (status) {
      query.status = status;
    }

    const journeys = await Journey.find(query)
      .sort({ 'timestamps.lastActivity': -1 }) // Most recent first
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .populate('userId', 'firstName lastName email');

    const total = await Journey.countDocuments(query);

    res.status(200).json({
      status: 'success',
      data: {
        journeys,
        pagination: {
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: (parseInt(offset) + parseInt(limit)) < total
        }
      }
    });

  } catch (error) {
    logger.error('Error in getUserJourneys:', error);
    next(new AppError('Failed to retrieve journeys', 500));
  }
};

/**
 * Get journey by ID
 * GET /api/v1/journeys/:id
 */
const getJourneyById = async (req, res, next) => {
  try {
    const journey = await Journey.findById(req.params.id)
      .populate('userId', 'firstName lastName email');

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    // Check if user owns this journey or has shared access
    if (journey.userId._id.toString() !== req.user._id.toString()) {
      const hasSharedAccess = journey.sharedWith.some(
        share => share.email === req.user.email
      );

      if (!hasSharedAccess) {
        return next(new AppError('Access denied to this journey', 403));
      }
    }

    res.status(200).json({
      status: 'success',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in getJourneyById:', error);
    next(new AppError('Failed to retrieve journey', 500));
  }
};

/**
 * Load journey progress by email (for frontend integration)
 * GET /api/v1/journeys/progress/:email
 */
const getJourneyProgress = async (req, res, next) => {
  try {
    const { email } = req.params;
    const { originCountry, destinationCountry } = req.query;

    let query = { email };

    if (originCountry && destinationCountry) {
      query.originCountry = originCountry.toUpperCase();
      query.destinationCountry = destinationCountry.toUpperCase();
    }

    // Get the most recent active journey
    const journey = await Journey.findOne({
      ...query,
      status: { $in: ['started', 'in_progress', 'under_review'] }
    }).sort({ 'timestamps.lastActivity': -1 });

    if (!journey) {
      return res.status(200).json({
        status: 'success',
        data: {
          progress: null
        }
      });
    }

    // Format response to match frontend ProgressData interface
    const progressData = {
      email: journey.email,
      originCountry: journey.originCountry,
      destinationCountry: journey.destinationCountry,
      userType: journey.userType,
      visaType: journey.visaType,
      personalizationData: journey.personalizationData,
      checklist: Object.fromEntries(journey.checklist),
      stepCompletion: Object.fromEntries(journey.stepCompletion),
      timestamps: journey.timestamps
    };

    res.status(200).json({
      status: 'success',
      data: {
        progress: progressData,
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in getJourneyProgress:', error);
    next(new AppError('Failed to load journey progress', 500));
  }
};

/**
 * Update journey step completion
 * PATCH /api/v1/journeys/:id/steps/:stepId
 */
const updateStepCompletion = async (req, res, next) => {
  try {
    const { id, stepId } = req.params;
    const { completed } = req.body;

    const journey = await Journey.findById(id);

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    if (journey.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied to this journey', 403));
    }

    if (completed) {
      await journey.markStepCompleted(stepId);
    } else {
      journey.stepCompletion.set(stepId, false);
      await journey.updateProgress();
    }

    res.status(200).json({
      status: 'success',
      message: `Step ${stepId} ${completed ? 'completed' : 'marked incomplete'}`,
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in updateStepCompletion:', error);
    next(new AppError('Failed to update step completion', 500));
  }
};

/**
 * Update journey checklist
 * PATCH /api/v1/journeys/:id/checklist
 */
const updateJourneyChecklist = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { checklist } = req.body;

    const journey = await Journey.findById(id);

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    if (journey.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied to this journey', 403));
    }

    await journey.updateChecklist(checklist);

    res.status(200).json({
      status: 'success',
      message: 'Checklist updated successfully',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in updateJourneyChecklist:', error);
    next(new AppError('Failed to update checklist', 500));
  }
};

/**
 * Update journey personalization
 * PATCH /api/v1/journeys/:id/personalization
 */
const updateJourneyPersonalization = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { personalizationData } = req.body;

    const journey = await Journey.findById(id);

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    if (journey.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied to this journey', 403));
    }

    await journey.updatePersonalization(personalizationData);

    res.status(200).json({
      status: 'success',
      message: 'Personalization updated successfully',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in updateJourneyPersonalization:', error);
    next(new AppError('Failed to update personalization', 500));
  }
};

/**
 * Share journey with another user
 * POST /api/v1/journeys/:id/share
 */
const shareJourney = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { email, permissions = 'view' } = req.body;

    const journey = await Journey.findById(id);

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    if (journey.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied to this journey', 403));
    }

    // Check if already shared with this user
    const existingShare = journey.sharedWith.find(share => share.email === email);

    if (existingShare) {
      existingShare.permissions = permissions;
    } else {
      journey.sharedWith.push({
        email,
        permissions,
        sharedAt: new Date()
      });
    }

    journey.isShared = true;
    await journey.save();

    res.status(200).json({
      status: 'success',
      message: 'Journey shared successfully',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in shareJourney:', error);
    next(new AppError('Failed to share journey', 500));
  }
};

/**
 * Add note to journey
 * POST /api/v1/journeys/:id/notes
 */
const addJourneyNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content } = req.body;

    const journey = await Journey.findById(id);

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    if (journey.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied to this journey', 403));
    }

    journey.notes.push({
      content,
      createdAt: new Date()
    });

    await journey.save();

    res.status(201).json({
      status: 'success',
      message: 'Note added successfully',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in addJourneyNote:', error);
    next(new AppError('Failed to add note', 500));
  }
};

/**
 * Get journey statistics
 * GET /api/v1/journeys/stats
 */
const getJourneyStats = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Get user's journey statistics
    const stats = await Journey.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: null,
          totalJourneys: { $sum: 1 },
          activeJourneys: {
            $sum: {
              $cond: [
                { $in: ['$status', ['started', 'in_progress', 'under_review']] },
                1,
                0
              ]
            }
          },
          completedJourneys: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, 1, 0]
            }
          },
          averageCompletion: { $avg: '$progressMetrics.completionPercentage' }
        }
      }
    ]);

    // Get popular routes for this user
    const routeStats = await Journey.aggregate([
      { $match: { userId } },
      {
        $group: {
          _id: {
            origin: '$originCountry',
            destination: '$destinationCountry'
          },
          count: { $sum: 1 },
          avgCompletion: { $avg: '$progressMetrics.completionPercentage' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        overview: stats[0] || {
          totalJourneys: 0,
          activeJourneys: 0,
          completedJourneys: 0,
          averageCompletion: 0
        },
        popularRoutes: routeStats
      }
    });

  } catch (error) {
    logger.error('Error in getJourneyStats:', error);
    next(new AppError('Failed to retrieve journey statistics', 500));
  }
};

/**
 * Delete journey
 * DELETE /api/v1/journeys/:id
 */
const deleteJourney = async (req, res, next) => {
  try {
    const { id } = req.params;

    const journey = await Journey.findById(id);

    if (!journey) {
      return next(new AppError('Journey not found', 404));
    }

    if (journey.userId.toString() !== req.user._id.toString()) {
      return next(new AppError('Access denied to this journey', 403));
    }

    await Journey.findByIdAndDelete(id);

    res.status(200).json({
      status: 'success',
      message: 'Journey deleted successfully'
    });

  } catch (error) {
    logger.error('Error in deleteJourney:', error);
    next(new AppError('Failed to delete journey', 500));
  }
};

/**
 * Save journey progress at each step
 * POST /api/v1/journeys/save-progress
 */
const saveJourneyProgress = async (req, res, next) => {
  try {
    const {
      userId,
      email,
      fromCountry,
      toCountry,
      userType,
      visaType,
      currentStep,
      personalizationData
    } = req.body;

    // Find the most recent journey for this user and route
    let journey = await Journey.findOne({
      $or: [
        { userId: userId },
        { email: email.toLowerCase() }
      ],
      originCountry: fromCountry.toUpperCase(),
      destinationCountry: toCountry.toUpperCase(),
      status: { $in: ['started', 'in_progress'] }
    }).sort({ 'timestamps.lastActivity': -1 });

    if (journey) {
      // Update existing journey
      journey.userType = userType || journey.userType;
      journey.visaType = visaType || journey.visaType;
      journey.currentStep = currentStep;
      journey.personalizationData = personalizationData || journey.personalizationData;
      journey.status = currentStep === 4 ? 'completed' : 'in_progress';
      journey.timestamps.lastActivity = new Date();

      // Update step completion timestamps
      journey.timestamps[`step${currentStep}Completed`] = new Date();

      await journey.save();
    } else {
      // Create new journey
      journey = await Journey.create({
        userId,
        email: email.toLowerCase(),
        originCountry: fromCountry.toUpperCase(),
        destinationCountry: toCountry.toUpperCase(),
        userType,
        visaType,
        currentStep,
        personalizationData,
        status: currentStep === 4 ? 'completed' : 'in_progress',
        timestamps: {
          journeyStarted: new Date(),
          lastActivity: new Date(),
          [`step${currentStep}Completed`]: new Date()
        }
      });
    }

    logger.info('Journey Progress Saved', {
      userId,
      journeyId: journey._id,
      currentStep,
      status: journey.status
    });

    res.status(200).json({
      status: 'success',
      message: 'Journey progress saved successfully',
      data: {
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in saveJourneyProgress:', error);
    next(new AppError('Failed to save journey progress', 500));
  }
};

/**
 * Get user's incomplete journey to resume where they left off
 * GET /api/v1/journeys/incomplete/:email
 */
const getIncompleteJourney = async (req, res, next) => {
  try {
    const { email } = req.params;

    // Find the most recent incomplete journey for this user
    const journey = await Journey.findOne({
      email: email.toLowerCase(),
      status: { $in: ['started', 'in_progress'] }
    }).sort({ 'timestamps.lastActivity': -1 });

    if (!journey) {
      return res.status(200).json({
        status: 'success',
        data: {
          hasIncompleteJourney: false,
          journey: null
        }
      });
    }

    logger.info('Incomplete Journey Retrieved', {
      userId: journey.userId,
      journeyId: journey._id,
      currentStep: journey.currentStep
    });

    res.status(200).json({
      status: 'success',
      data: {
        hasIncompleteJourney: true,
        journey: journey.toObject()
      }
    });

  } catch (error) {
    logger.error('Error in getIncompleteJourney:', error);
    next(new AppError('Failed to get incomplete journey', 500));
  }
};

/**
 * Get user's most recent incomplete journey for auto-resume
 * GET /api/v1/journeys/resume/:email
 */
const getResumeJourney = async (req, res, next) => {
  try {
    const { email } = req.params;

    // Find the most recent incomplete journey for this user
    const journey = await Journey.findOne({
      email: email.toLowerCase(),
      status: { $in: ['started', 'in_progress'] }
    }).sort({ 'timestamps.lastActivity': -1 });

    if (!journey) {
      return res.status(200).json({
        status: 'success',
        data: {
          shouldResume: false,
          journey: null
        }
      });
    }

    // Return journey data for resuming
    res.status(200).json({
      status: 'success',
      data: {
        shouldResume: true,
        journey: {
          id: journey._id,
          fromCountry: journey.originCountry,
          toCountry: journey.destinationCountry,
          currentStep: journey.currentStep || 1,
          personalizationData: journey.personalizationData,
          stepCompletion: Object.fromEntries(journey.stepCompletion || new Map()),
          checklist: Object.fromEntries(journey.checklist || new Map()),
          userType: journey.userType,
          visaType: journey.visaType
        }
      }
    });

  } catch (error) {
    logger.error('Error in getResumeJourney:', error);
    next(new AppError('Failed to get resume journey', 500));
  }
};

module.exports = {
  createOrUpdateJourney,
  getUserJourneys,
  getJourneyById,
  getJourneyProgress,
  updateStepCompletion,
  updateJourneyChecklist,
  updateJourneyPersonalization,
  shareJourney,
  addJourneyNote,
  getJourneyStats,
  deleteJourney,
  saveJourneyProgress,
  getIncompleteJourney,
  getResumeJourney
};