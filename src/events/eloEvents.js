const EventEmitter = require('events');

/**
 * Event emitter for skill rating / elo updates across the application.
 * Any modification to player ratings (match record, undo, setelo, link, etc.)
 * emits an 'eloChange' event, triggering automated updates to persistent widgets.
 */
class EloEventEmitter extends EventEmitter {}

const eloEvents = new EloEventEmitter();

module.exports = eloEvents;
