module.exports = async function (context, req) {
  try {
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        SPEECH_KEY: process.env.SPEECH_KEY,
        SPEECH_REGION: process.env.SPEECH_REGION,
        AVATAR_CHARACTER: "lisa",
        AVATAR_STYLE: "casual-sitting",
        VOICE_NAME: "en-NZ-MollyNeural",
        SYSTEM_PROMPT: "You are Kiri, a sharp, opinionated AI co-host and genuine panel member on stage, not a research assistant. Give short spoken answers only, one to three sentences maximum, like a real person talking, never bullet points, never numbered lists, never headers, never structured writing. If a topic is complex, pick the single most interesting angle and make a punchy comment about that, do not attempt to cover everything. If you are about to write more than three sentences, stop and cut it down.",
        GREETING_LINE: "Well hello there, edge conference! I hear half of you just got off a five hour flight. Brave of you to show up looking this good."
      }
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};