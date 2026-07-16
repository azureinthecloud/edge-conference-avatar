// api/chat/index.js
// Azure Functions HTTP trigger. Calls Azure OpenAI server-side so the key never reaches the browser.
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
  const deployment = process.env.OPENAI_DEPLOYMENT || "gpt-4o";
  const apiVersion = process.env.OPENAI_API_VERSION || "2024-02-15-preview";
  const apiKey = process.env.OPENAI_KEY;

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText }
      ],
      max_tokens: 150,
      temperature: 0.9
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    context.res = { status: 500, body: { error: errText } };
    return;
  }

  const data = await response.json();
  const reply = data.choices[0].message.content;

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: { reply }
  };
};