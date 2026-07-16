const fetch = require("node-fetch");

module.exports = async function (context, req) {
  const userText = req.body && req.body.userText;
  const systemPrompt = (req.body && req.body.systemPrompt) ||
    "You are a witty AI co-host at a tech conference. Keep replies short and funny.";

  if (!userText) {
    context.res = { status: 400, body: { error: "Missing userText" } };
    return;
  }

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

  if (!response.ok) {
    const errText = await response.text();
    context.res = { status: 500, body: { error: errText } };
    return;
  }

  const data = await response.json();
  const reply = data.output && data.output[0] && data.output[0].content
    ? data.output[0].content[0].text
    : "Sorry, I've got nothing clever right now.";

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { reply }
  };
};