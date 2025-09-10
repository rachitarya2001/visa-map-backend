const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { handleValidationErrors } = require('../middleware/validation');
const journeyController = require('../controllers/journeyController');
const { authenticate } = require('../middleware/auth');

router.get('/test', (req, res) => {
  res.json({ message: 'Journey routes working' });
});

router.get('/progress/:email', (req, res) => {
  res.json({
    status: 'success',
    data: { progress: null }
  });
});

router.get('/stats', (req, res) => {
  res.json({
    status: 'success',
    data: { message: 'Stats working' }
  });
});

// Add this new route to handle POST /progress
router.post('/progress', (req, res) => {
  res.json({
    status: 'success',
    message: 'Progress saved successfully',
    data: { progress: req.body }
  });
});

router.post('/',
  authenticate,
  journeyController.createOrUpdateJourney
);

// router.get('/', (req, res) => {
//   res.json({
//     status: 'success',
//     data: { journeys: [] }
//   });
// });

router.get('/',
  authenticate,  // ADD authentication middleware
  journeyController.getUserJourneys
);

router.get('/:id',
  authenticate,
  journeyController.getJourneyById
);

router.delete('/:id',
  authenticate,
  journeyController.deleteJourney
);

router.patch('/:id/steps/:stepId', (req, res) => {
  res.json({ status: 'success', message: 'Step update working' });
});

router.patch('/:id/checklist', (req, res) => {
  res.json({ status: 'success', message: 'Checklist working' });
});

router.patch('/:id/personalization', (req, res) => {
  res.json({ status: 'success', message: 'Personalization working' });
});

router.post('/:id/share', (req, res) => {
  res.json({ status: 'success', message: 'Share working' });
});

router.post('/:id/notes', (req, res) => {
  res.json({ status: 'success', message: 'Notes working' });
});


router.post('/save-progress',
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('fromCountry')
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .withMessage('Origin country must be a 2-letter country code'),
  body('toCountry')
    .isLength({ min: 2, max: 2 })
    .isAlpha()
    .withMessage('Destination country must be a 2-letter country code'),
  body('currentStep')
    .isInt({ min: 1, max: 4 })
    .withMessage('Current step must be between 1 and 4'),
  handleValidationErrors,
  journeyController.saveJourneyProgress
);

/**
 * @route   GET /api/v1/journeys/incomplete/:email
 * @desc    Get user's incomplete journey to resume
 * @access  Public
 */
router.get('/incomplete/:email',
  param('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  handleValidationErrors,
  journeyController.getIncompleteJourney
);

/**
 * @route   GET /api/v1/journeys/resume/:email
 * @desc    Get user's most recent journey to auto-resume
 * @access  Public
 */
router.get('/resume/:email',
  param('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  handleValidationErrors,
  journeyController.getResumeJourney
);

module.exports = router;