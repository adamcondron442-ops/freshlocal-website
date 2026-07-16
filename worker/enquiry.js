const ALLOWED_ORIGINS = new Set(['https://freshlocal.org.uk', 'https://www.freshlocal.org.uk']);
const LOCAL_PREVIEW_ORIGINS = new Set(['http://127.0.0.1:8787', 'http://localhost:8787']);
const INTEREST_TYPES = new Set(['Buyer', 'Seller or producer', 'Local business', 'Community organisation', 'Other']);
const LIMITS = { name: 100, email: 254, area: 100, message: 2000, company: 200 };
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isAllowedOrigin(origin, env) {
  return ALLOWED_ORIGINS.has(origin) ||
    (env.ENVIRONMENT === 'development' && LOCAL_PREVIEW_ORIGINS.has(origin));
}
function jsonResponse(body, status, origin, env = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" };
  if (origin && isAllowedOrigin(origin, env)) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
  return new Response(JSON.stringify(body), { status, headers });
}
function cleanString(value) { return typeof value === 'string' ? value.trim() : ''; }
export function validateEnquiry(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: { form: 'Invalid enquiry data.' } };
  const data = { name: cleanString(input.name), email: cleanString(input.email).toLowerCase(), interestType: cleanString(input.interestType), area: cleanString(input.area), message: cleanString(input.message), company: cleanString(input.company), consent: input.consent === true };
  const errors = {};
  if (!data.name) errors.name = 'Name is required.'; else if (data.name.length > LIMITS.name) errors.name = 'Name is too long.';
  if (!data.email || !EMAIL_PATTERN.test(data.email)) errors.email = 'A valid email address is required.'; else if (data.email.length > LIMITS.email) errors.email = 'Email address is too long.';
  if (!INTEREST_TYPES.has(data.interestType)) errors.interestType = 'Choose a valid interest type.';
  if (data.area.length > LIMITS.area) errors.area = 'Town or postcode area is too long.';
  if (!data.message) errors.message = 'Enquiry or message is required.'; else if (data.message.length > LIMITS.message) errors.message = 'Enquiry or message is too long.';
  if (!data.consent) errors.consent = 'Acknowledgement is required.';
  if (data.company.length > LIMITS.company) errors.company = 'Invalid field.';
  return { ok: Object.keys(errors).length === 0, data, errors };
}
function buildEmailText(data, request) {
  return ['New FreshLocal website enquiry', '', `Name: ${data.name}`, `Email: ${data.email}`, `Interest type: ${data.interestType}`, `Town or postcode area: ${data.area || 'Not supplied'}`, 'Acknowledgement: Yes', '', 'Message:', data.message, '', `Submitted: ${new Date().toISOString()}`, `Country (Cloudflare): ${request.headers.get('CF-IPCountry') || 'Not available'}`].join('\n');
}
export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const url = new URL(request.url);
    if (url.pathname !== '/api/enquiry') return jsonResponse({ message: 'Not found.' }, 404, origin, env);
    if (!origin || !isAllowedOrigin(origin, env)) return jsonResponse({ message: 'This request is not allowed.' }, 403);
    if (request.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405, origin, env);
    const contentType = request.headers.get('Content-Type') || '';
    if (!contentType.toLowerCase().startsWith('application/json')) return jsonResponse({ message: 'Content type must be application/json.' }, 415, origin, env);
    if (Number(request.headers.get('Content-Length') || 0) > 10000) return jsonResponse({ message: 'Enquiry is too large.' }, 413, origin, env);
    let input;
    try { input = await request.json(); } catch { return jsonResponse({ message: 'Invalid enquiry data.' }, 400, origin, env); }
    const validation = validateEnquiry(input);
    if (!validation.ok) return jsonResponse({ message: 'Please check the form and try again.', errors: validation.errors }, 400, origin, env);
    if (validation.data.company) return jsonResponse({ success: true }, 200, origin, env);
    try {
      await env.ENQUIRY_EMAIL.send({ to: 'freshlocal@protonmail.com', from: 'enquiries@freshlocal.org.uk', replyTo: validation.data.email, subject: `FreshLocal enquiry: ${validation.data.interestType}`, text: buildEmailText(validation.data, request) });
      return jsonResponse({ success: true }, 200, origin, env);
    } catch (error) {
      console.error('Enquiry email delivery failed', error && error.code ? error.code : 'unknown');
      return jsonResponse({ message: 'Your enquiry could not be sent right now. Please try again shortly.' }, 502, origin, env);
    }
  }
};
