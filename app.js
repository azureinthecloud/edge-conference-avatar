let avatarSynthesizer = null;
let speechRecognizer = null;
let peerConnection = null;
let sessionActive = false;
let isListening = false;
let isSpeaking = false;
let config = null;
let hasStarted = false;

const conversationState = {
  transcriptBuffer: [],
  maxTranscriptItems: 14,
  wakeName: "kiri",
  awaitingReply: false
};

function el(id) {
  return document.getElementById(id);
}

function setStatus(text) {
  const node = el("statusPill");
  if (node) node.textContent = text;
}

function showCaption(text) {
  const node = el("captionBar");
  if (!node) return;
  node.textContent = text || "";
  node.classList.toggle("show", !!text);
}

function clearCaption() {
  const node = el("captionBar");
  if (!node) return;
  node.textContent = "";
  node.classList.remove("show");
}

function setListening(active) {
  isListening = active;
  el("listeningIndicator")?.classList.toggle("active", active);
}

function logDebug(message) {
  const panel = el("debugLog");
  if (!panel) return;
  const time = new Date().toLocaleTimeString();
  panel.textContent += `[${time}] ${message}\n`;
  panel.scrollTop = panel.scrollHeight;
}

function encode(text) {
  const div = document.createElement("div");
  div.innerText = text || "";
  return div.innerHTML;
}

function normalizeForSpeech(text) {
  return (text || "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/^[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

function addToTranscriptBuffer(text) {
  const clean = normalizeForSpeech(text);
  if (!clean) return;

  conversationState.transcriptBuffer.push(clean);
  if (conversationState.transcriptBuffer.length > conversationState.maxTranscriptItems) {
    conversationState.transcriptBuffer.shift();
  }

  logDebug(`Context: ${clean}`);
}

function shouldWakeKiri(text) {
  const t = (text || "").toLowerCase();

  if (!t.includes(conversationState.wakeName)) return false;

  const invitationPatterns = [
    "what do you think",
    "what do you reckon",
    "your view",
    "your take",
    "thoughts",
    "jump in",
    "do you agree",
    "come in here",
    "over to you",
    "what would you add",
    "where do you land",
    "kiri?",
    "kiri,"
  ];

  return invitationPatterns.some(pattern => t.includes(pattern)) || t.includes("?");
}

function buildSystemPrompt() {
  return (
    config?.SYSTEM_PROMPT ||
    window.APP_CONFIG?.SYSTEM_PROMPT ||
    `
You are Kiri, the third participant in a live on-stage discussion with two human speakers.
You are listening to an ongoing conversation in front of a live audience.
You stay quiet unless one of the humans directly addresses you by name or clearly invites your view.
Keep replies short, usually 1 to 2 sentences.
Sound natural, spoken, confident, and warm.
React to the last human point first, then add your own angle.
Do not answer like an assistant or lecturer.
Do not give lists or mini-presentations.
If the humans are clearly continuing their own exchange, stay quiet unless invited.
    `.trim()
  );
}

function buildChatInput(directQuestion) {
  const recentContext = conversationState.transcriptBuffer.slice(-10).join("\n");

  return `
Recent live conversation context:
${recentContext}

The humans have now directly addressed you.

Direct line to Kiri:
${directQuestion}

Respond as Kiri in a live panel discussion.
Keep it brief, natural, and spoken aloud.
Use 1 to 2 sentences, or 3 at most if absolutely necessary.
`.trim();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/get-config");
    if (!response.ok) throw new Error("Failed to load config");
    config = await response.json();
    logDebug("Config loaded from /api/get-config");
  } catch (error) {
    config = window.APP_CONFIG || {};
    logDebug(`Using fallback config.js: ${error.message}`);
  }
}

async function connectAvatar() {
  if (sessionActive) return;
  if (!config) await loadConfig();

  const speechKey = config?.SPEECH_KEY || window.APP_CONFIG?.SPEECH_KEY;
  const speechRegion = config?.SPEECH_REGION || window.APP_CONFIG?.SPEECH_REGION;
  const avatarCharacter = config?.AVATAR_CHARACTER || window.APP_CONFIG?.AVATAR_CHARACTER || "lisa";
  const avatarStyle = config?.AVATAR_STYLE || window.APP_CONFIG?.AVATAR_STYLE || "casual-sitting";
  const voiceName = config?.VOICE_NAME || window.APP_CONFIG?.VOICE_NAME || "en-US-Ava:DragonHDLatestNeural";

  if (!speechKey || !speechRegion) {
    setStatus("Missing config");
    alert("Missing speech configuration.");
    return;
  }

  setStatus("Connecting avatar...");
  logDebug("Connecting avatar");

  const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(speechKey, speechRegion);
  speechSynthesisConfig.speechSynthesisVoiceName = voiceName;

  const avatarConfig = new SpeechSDK.AvatarConfig(avatarCharacter, avatarStyle);
  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);

  const relayTokenUrl = `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;
  const relayResponse = await fetch(relayTokenUrl, {
    method: "GET",
    headers: { "Ocp-Apim-Subscription-Key": speechKey }
  });

  if (!relayResponse.ok) {
    const errorText = await relayResponse.text();
    throw new Error(`Relay token error: ${errorText}`);
  }

  const relayData = await relayResponse.json();

  peerConnection = new RTCPeerConnection({
    iceServers: [{
      urls: relayData.Urls,
      username: relayData.Username,
      credential: relayData.Password
    }]
  });

  peerConnection.ontrack = function (event) {
    const remoteVideo = el("remoteVideo");
    if (!remoteVideo) return;

    let video = remoteVideo.querySelector("video");
    if (!video) {
      video = document.createElement("video");
      video.autoplay = true;
      video.playsInline = true;
      remoteVideo.innerHTML = "";
      remoteVideo.appendChild(video);
    }

    video.srcObject = event.streams[0];
  };

  peerConnection.addTransceiver("video", { direction: "sendrecv" });
  peerConnection.addTransceiver("audio", { direction: "sendrecv" });

  const result = await avatarSynthesizer.startAvatarAsync(peerConnection);
  logDebug(`Avatar started: ${JSON.stringify(result)}`);

  sessionActive = true;
  setStatus("Kiri live");

  await greetAudience();
  startListening();
}

async function greetAudience() {
  const greeting =
    "Kia ora, and welcome to all the Kiwis at Edge Conference in Australia. It’s an absolute pleasure to be here with you. My name is Kiri. I’m an AI avatar created by Ingram Micro in New Zealand, and I’d like to share some very important security information. Apparently, one of the weakest passwords you can use is beef stew, because it’s not stroganoff.";

  await speakText(greeting, {
    rate: "0%",
    pitch: "0%",
    trailingBreakMs: 0
  });

  await wait(260);

  await speakText("Ba dum tss.", {
    rate: "-8%",
    pitch: "-6%",
    trailingBreakMs: 0
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function speakText(text, options = {}) {
  if (!avatarSynthesizer || !text) return;

  const cleaned = normalizeForSpeech(text);
  if (!cleaned) return;

  isSpeaking = true;
  conversationState.awaitingReply = false;
  setStatus("Kiri speaking");
  showCaption(cleaned);
  logDebug(`Kiri: ${cleaned}`);

  const voiceName = config?.VOICE_NAME || window.APP_CONFIG?.VOICE_NAME || "en-US-Ava:DragonHDLatestNeural";
  const safeText = encode(cleaned);
  const rate = options.rate ?? "2%";
  const pitch = options.pitch ?? "0%";
  const trailingBreakMs = options.trailingBreakMs ?? 180;
  const trailingBreak = trailingBreakMs > 0 ? `<break time='${trailingBreakMs}ms'/>` : "";

  const ssml = `
<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-NZ'>
  <voice name='${voiceName}'>
    <prosody rate='${rate}' pitch='${pitch}'>${safeText}</prosody>${trailingBreak}
  </voice>
</speak>`;

  try {
    await avatarSynthesizer.speakSsmlAsync(ssml);
  } catch (error) {
    logDebug(`Speak error: ${error.message}`);
  } finally {
    isSpeaking = false;
    setStatus(isListening ? "Listening" : "Kiri live");
    setTimeout(clearCaption, 1200);
  }
}

function stopSpeaking() {
  if (!avatarSynthesizer) return;
  try {
    avatarSynthesizer.stopSpeakingAsync();
  } catch (error) {
    logDebug(`Stop speaking warning: ${error.message}`);
  }
  isSpeaking = false;
  clearCaption();
}

async function sendToKiri(directQuestion) {
  if (conversationState.awaitingReply) return;
  conversationState.awaitingReply = true;

  try {
    setStatus("Thinking...");
    logDebug(`Wake trigger: ${directQuestion}`);

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userText: buildChatInput(directQuestion),
        systemPrompt: buildSystemPrompt()
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText);
    }

    const data = await response.json();
    const reply = normalizeForSpeech(data.reply || "I think the interesting part is how fast this is moving.");

    addToTranscriptBuffer(`Kiri: ${reply}`);
    await speakText(reply);
  } catch (error) {
    logDebug(`Chat error: ${error.message}`);
    await speakText("Sorry, I missed that — ask me again.");
  } finally {
    conversationState.awaitingReply = false;
  }
}

function startListening() {
  if (!config || speechRecognizer) return;

  const speechKey = config?.SPEECH_KEY || window.APP_CONFIG?.SPEECH_KEY;
  const speechRegion = config?.SPEECH_REGION || window.APP_CONFIG?.SPEECH_REGION;

  const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(speechKey, speechRegion);
  speechConfig.speechRecognitionLanguage = "en-NZ";

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  speechRecognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  speechRecognizer.recognizing = function (s, e) {
    if (isSpeaking) return;
    const text = e.result?.text || "";
    if (text) showCaption(text);
  };

  speechRecognizer.recognized = async function (s, e) {
    if (e.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return;

    const text = normalizeForSpeech(e.result.text || "");
    if (!text || isSpeaking) return;

    clearCaption();
    addToTranscriptBuffer(text);

    if (shouldWakeKiri(text)) {
      await sendToKiri(text);
    }
  };

  speechRecognizer.canceled = function (s, e) {
    logDebug(`Recognition canceled: ${e.reason || "unknown"}`);
    setListening(false);
    setStatus("Mic issue");
  };

  speechRecognizer.sessionStopped = function () {
    logDebug("Recognition session stopped");
    setListening(false);
    if (sessionActive) setStatus("Kiri live");
  };

  speechRecognizer.startContinuousRecognitionAsync(
    () => {
      setListening(true);
      setStatus("Listening");
      logDebug("Continuous recognition started");
    },
    err => {
      logDebug(`Recognition start failed: ${err}`);
      setListening(false);
      setStatus("Mic blocked");
    }
  );
}

async function startExperience() {
  if (hasStarted) return;
  hasStarted = true;

  el("idleOverlay")?.classList.add("hidden");
  setStatus("Starting...");

  try {
    await loadConfig();
    await connectAvatar();
  } catch (error) {
    logDebug(`Start failed: ${error.message}`);
    setStatus("Start failed");
    el("idleOverlay")?.classList.remove("hidden");
    hasStarted = false;
  }
}

function bindUi() {
  const overlay = el("idleOverlay");

  overlay?.addEventListener("click", () => {
    startExperience();
  });

  overlay?.addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault();
      startExperience();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!hasStarted && e.code === "Space") {
      e.preventDefault();
      startExperience();
    }

    if (e.code === "Escape") {
      stopSpeaking();
    }

    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      el("debugPanel")?.classList.toggle("visible");
    }
  });
}

window.addEventListener("load", () => {
  bindUi();
  setStatus("Ready");
});