module.exports = async function (context, req) {
  const userText = req.body && req.body.userText;
  const systemPrompt = (req.body && req.body.systemPrompt) ||
    "You are a witty AI co-host at a tech conference. Keep replies short and funny.";

  if (!userText) {
    context.res = { status: 400, body: { error: "Missing userText" } };
    return;
  }

  try {
    const endpoint = process.env.OPENAI_ENDPOINT;
    const deployment = process.env.OPENAI_DEPLOYMENT || "gpt-5-mini";
    const apiKey = process.env.OPENAI_KEY;

    const url = `${endpoint}/responses`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey
      },
      body: JSON.stringify({
        model: deployment,
        input: `${systemPrompt}\n\nUser: ${userText}`
      })
    });

    const raw = await response.text();
    context.log("Status:", response.status, "Body:", raw);

    if (!response.ok) {
      context.res = { status: 500, body: { error: raw } };
      return;
    }

    const data = JSON.parse(raw);

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
      body: { reply: reply || "Sorry, I've got nothing clever right now." }
    };
  } catch (err) {
    context.log("ERROR:", err.message, err.stack);
    context.res = { status: 500, body: { error: err.message } };
  }
};