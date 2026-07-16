let lastResponseId = null; // module-level, persists across calls in the same function instance

module.exports = async function (context, req) {
  const userText = req.body && req.body.userText;
  const systemPrompt = (req.body && req.body.systemPrompt) ||
    "You are a witty AI co-host at a tech conference.";

  if (!userText) {
    context.res = { status: 400, body: { error: "Missing userText" } };
    return;
  }

  try {
    const endpoint = process.env.OPENAI_ENDPOINT;
    const deployment = process.env.OPENAI_DEPLOYMENT || "gpt-5-mini";
    const apiKey = process.env.OPENAI_KEY;
    const url = `${endpoint}/responses`;

    const body = {
      model: deployment,
      input: userText
    };

    if (lastResponseId) {
      body.previous_response_id = lastResponseId;
    } else {
      body.instructions = systemPrompt;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(body)
    });

    const raw = await response.text();
    if (!response.ok) {
      context.res = { status: 500, body: { error: raw } };
      return;
    }

    const data = JSON.parse(raw);
    lastResponseId = data.id;

    let reply = data.output_text || null;
    if (!reply && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.content && Array.isArray(item.content)) {
          const textPart = item.content.find(c => c.text);
          if (textPart) { reply = textPart.text; break; }
        }
      }
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { reply: reply || "Give me a sec, lost my train of thought." }
    };
  } catch (err) {
    context.res = { status: 500, body: { error: err.message } };
  }
};