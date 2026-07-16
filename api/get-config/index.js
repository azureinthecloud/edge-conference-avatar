// api/get-config/index.js
// Azure Functions HTTP trigger bundled with Static Web Apps.
// Keys are read from Application Settings (Configuration blade), never from client code.
module.exports = async function (context, req) {
  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: {
      SPEECH_KEY: process.env.SPEECH_KEY,
      SPEECH_REGION: process.env.SPEECH_REGION,
      AVATAR_CHARACTER: "lisa",
      AVATAR_STYLE: "casual-sitting",
      VOICE_NAME: "en-US-Ava:DragonHDLatestNeural",
      SYSTEM_PROMPT: "You are a witty, upbeat AI co-host welcoming tired conference attendees who just got off a long flight at the edge conference. Keep replies short, punchy, and funny."
    }
  };
};