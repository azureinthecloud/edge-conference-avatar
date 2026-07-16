// Fill these in locally before deploying. DO NOT commit real keys to source control.
// Recommended: use Azure Static Web Apps "Application settings" + a serverless API route
// to inject these at runtime instead of hardcoding. See api/get-config for that pattern.
window.APP_CONFIG = {
  SPEECH_KEY: "",         // set via /api/get-config in production, leave blank here
  SPEECH_REGION: "",      // e.g. "eastus2"
  OPENAI_ENDPOINT: "",    // e.g. "https://YOUR-RESOURCE.openai.azure.com"
  OPENAI_DEPLOYMENT: "gpt-4o",
  OPENAI_API_VERSION: "2024-02-15-preview",
  AVATAR_CHARACTER: "lisa",
  AVATAR_STYLE: "casual-sitting",
  VOICE_NAME: "en-US-Ava:DragonHDLatestNeural",
  SYSTEM_PROMPT: "You are a witty, upbeat AI co-host welcoming tired conference attendees who just got off a long flight at the edge conference. Keep replies short, punchy, and funny."
};