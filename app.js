let speechRecognizer = null;
let avatarSynthesizer = null;
let peerConnection = null;
let sessionActive = false;
let isSpeaking = false;
let isListening = false;
let config = null;

const state = {
  activeSpeaker: "Craig",
  responseMode: "react",
  currentTranscript: "",
  spokenQueue: [],
  wakeWord: "kiri"
};

const sentenceLevelPunctuations = [".", "?", "!", ":", ";", "。", "？", "！", "：", "；"];

function $(id) {
  return document.getElementById(id);
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

function showCaption(text) {
  const bar = $("captionBar");
  if (!bar) return;
  bar.textContent = text || "";
  bar.classList.toggle("show", !!text);
}

function clearCaption() {
  const bar = $("captionBar");
  if (!bar) return;
  bar.textContent = "";
  bar.classList.remove("show");
}

function setListening(active) {
  isListening = active;
  const indicator = $("listeningIndicator");
  if (indicator) {
    indicator.classList.toggle("active", active);
  }
}

function appendTranscript(label, text) {
  const history = $("chatHistory");
  if (!history) return;
  const row = document.createElement("div");
  row.style.margin = "0 0 12px 0";
  row.innerHTML = `<strong>${encode(label)}:</strong> ${encode(text)}`;
  history.appendChild(row);
  history.scrollTop = history.scrollHeight;
}

function buildSystemPrompt() {
  const basePrompt =
    config?.SYSTEM_PROMPT ||
    window.APP_CONFIG?.SYSTEM_PROMPT ||
    "You are Kiri, a sharp AI co-host and natural panel participant.";

  return `${basePrompt}

Extra live panel rules:
- You are on stage with Craig and Naas.
- React to what they just said before adding your own point.
- Keep replies short and spoken, usually 1 to 3 sentences.
- Sound like a real person in the room, not a chatbot.
- Be warm, witty, commercially aware, and natural.
- Never use bullet points, numbered lists, or headings.
- Never say 'How can I help?' or 'Here is a summary.'
- If the audience says 'Kiri', respond naturally as the co-host.`;
}

function buildPanelPrompt(userText) {
  const modeInstructions = {
    react: "Respond briefly with agreement, interpretation, or reframing.",
    expand: "Build on the point with one extra practical insight.",
    transition: "Bridge naturally to the next idea or speaker handoff.",
    challenge: "Offer a polite, constructive caution or qualifier."
  };

  return `
Speaker who just spoke: ${state.activeSpeaker}
Response mode: ${state.responseMode}
Instruction: ${modeInstructions[state.responseMode] || modeInstructions.react}

What was just said:
${userText}

Respond as Kiri in a natural live panel discussion.
Keep it concise, conversational, and suitable for speaking aloud.
Acknowledge the point first, then add insight.
Use 1 to 3 sentences.
`.trim();
}

async function loadConfig() {
  try {
    const response = await fetch("/api/get-config");
    if (!response.ok) throw new Error("Failed to load config");
    config = await response.json();
  } catch (err) {
    console.warn("Falling back to window.APP_CONFIG", err);
    config = window.APP_CONFIG || {};
  }

  if ($("sessionStatus")) {
    $("sessionStatus").textContent = "Config loaded";
  }
}

async function connectAvatar() {
  if (sessionActive) return;

  if (!config) {
    await loadConfig();
  }

  const speechKey = config?.SPEECH_KEY || window.APP_CONFIG?.SPEECH_KEY;
  const speechRegion = config?.SPEECH_REGION || window.APP_CONFIG?.SPEECH_REGION;
  const avatarCharacter = config?.AVATAR_CHARACTER || window.APP_CONFIG?.AVATAR_CHARACTER || "lisa";
  const avatarStyle = config?.AVATAR_STYLE || window.APP_CONFIG?.AVATAR_STYLE || "casual-sitting";
  const voiceName = config?.VOICE_NAME || window.APP_CONFIG?.VOICE_NAME || "en-US-Ava:DragonHDLatestNeural";

  if (!speechKey || !speechRegion) {
    alert("Missing speech configuration. Check /api/get-config or config.js");
    return;
  }

  const speechSynthesisConfig = SpeechSDK.SpeechConfig.fromSubscription(speechKey, speechRegion);
  speechSynthesisConfig.speechSynthesisVoiceName = voiceName;

  const avatarConfig = new SpeechSDK.AvatarConfig(avatarCharacter, avatarStyle);
  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechSynthesisConfig, avatarConfig);

  avatarSynthesizer.avatarEventReceived = function (s, e) {
    console.log("Avatar event:", e.description);
  };

  const relayTokenUrl = `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`;

  const tokenResponse = await fetch(relayTokenUrl, {
    method: "GET",
    headers: {
      "Ocp-Apim-Subscription-Key": speechKey
    }
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    throw new Error(`Failed to get relay token: ${text}`);
  }

  const tokenData = await tokenResponse.json();

  peerConnection = new RTCPeerConnection({
    iceServers: [
      {
        urls: tokenData.Urls,
        username: tokenData.Username,
        credential: tokenData.Password
      }
    ]
  });

  peerConnection.ontrack = function (event) {
    const remoteVideo = $("remoteVideo");
    if (!remoteVideo) return;

    if (event.track.kind === "video") {
      let videoEl = remoteVideo.querySelector("video");
      if (!videoEl) {
        videoEl = document.createElement("video");
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        remoteVideo.innerHTML = "";
        remoteVideo.appendChild(videoEl);
      }
      videoEl.srcObject = event.streams[0];
    }
  };

  peerConnection.addTransceiver("video", { direction: "sendrecv" });
  peerConnection.addTransceiver("audio", { direction: "sendrecv" });

  const result = await avatarSynthesizer.startAvatarAsync(peerConnection);
  console.log("Avatar start result:", result);

  sessionActive = true;
  if ($("sessionStatus")) $("sessionStatus").textContent = "Connected";
  if ($("idleOverlay")) $("idleOverlay").style.display = "none";

  await greetAudience();
}

async function greetAudience() {
  const greeting =
    config?.GREETING_LINE ||
    window.APP_CONFIG?.GREETING_LINE ||
    "Hello everyone, I’m Kiri. Let’s get into it.";

  appendTranscript("Kiri", greeting);
  await speakText(greeting);
}

async function disconnectAvatar() {
  try {
    stopListening();
    stopSpeaking();

    if (avatarSynthesizer) {
      await avatarSynthesizer.stopAvatarAsync();
      avatarSynthesizer.close();
      avatarSynthesizer = null;
    }

    if (peerConnection) {
      peerConnection.close();
      peerConnection = null;
    }
  } catch (err) {
    console.error("Disconnect error:", err);
  }

  sessionActive = false;
  if ($("sessionStatus")) $("sessionStatus").textContent = "Disconnected";
  if ($("idleOverlay")) $("idleOverlay").style.display = "flex";
}

async function speakText(text) {
  if (!avatarSynthesizer || !text) return;

  const cleaned = normalizeForSpeech(text);
  if (!cleaned) return;

  isSpeaking = true;
  showCaption(cleaned);

  const voiceName = config?.VOICE_NAME || window.APP_CONFIG?.VOICE_NAME || "en-US-Ava:DragonHDLatestNeural";

  const ssml = `
<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'>
  <voice name='${voiceName}'>
    <prosody rate='0%' pitch='0%'>${encode(cleaned)}</prosody>
    <break time='250ms'/>
  </voice>
</speak>`;

  return new Promise((resolve, reject) => {
    avatarSynthesizer.speakSsmlAsync(ssml).then(() => {
      isSpeaking = false;
      setTimeout(() => {
        clearCaption();
      }, 1200);
      resolve();
    }).catch(err => {
      isSpeaking = false;
      console.error("Speak error:", err);
      reject(err);
    });
  });
}

function stopSpeaking() {
  if (!avatarSynthesizer) return;
  try {
    avatarSynthesizer.stopSpeakingAsync();
  } catch (err) {
    console.warn("stopSpeakingAsync warning:", err);
  }
  isSpeaking = false;
  clearCaption();
}

async function sendPanelTurn(textOverride = null) {
  const box = $("userMessageBox");
  const text = (textOverride || box?.value || "").trim();
  if (!text) return;

  appendTranscript(state.activeSpeaker, text);

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      userText: buildPanelPrompt(text),
      systemPrompt: buildSystemPrompt()
    })
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Chat API error:", err);
    appendTranscript("Kiri", "Sorry, I lost my train of thought for a second.");
    return;
  }

  const data = await response.json();
  const reply = normalizeForSpeech(data.reply || "Give me a sec, lost my train of thought.");

  appendTranscript("Kiri", reply);
  await speakText(reply);

  if (box) {
    box.value = "";
  }
}

function startListening() {
  if (!config) return;
  if (speechRecognizer) return;

  const speechKey = config?.SPEECH_KEY || window.APP_CONFIG?.SPEECH_KEY;
  const speechRegion = config?.SPEECH_REGION || window.APP_CONFIG?.SPEECH_REGION;

  const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(speechKey, speechRegion);
  speechConfig.speechRecognitionLanguage = "en-NZ";

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  speechRecognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  speechRecognizer.recognizing = function (s, e) {
    const text = e.result?.text || "";
    if (text) {
      state.currentTranscript = text;
      showCaption(text);
    }
  };

  speechRecognizer.recognized = async function (s, e) {
    if (e.result.reason !== SpeechSDK.ResultReason.RecognizedSpeech) return;

    const text = (e.result.text || "").trim();
    if (!text) return;

    state.currentTranscript = text;
    console.log("Recognized:", text);

    const lower = text.toLowerCase();

    if (!sessionActive) return;

    if (lower.includes(state.wakeWord)) {
      await sendPanelTurn(text);
    }
  };

  speechRecognizer.canceled = function (s, e) {
    console.warn("Speech recognition canceled:", e);
    setListening(false);
  };

  speechRecognizer.sessionStopped = function () {
    setListening(false);
  };

  speechRecognizer.startContinuousRecognitionAsync(
    () => setListening(true),
    err => {
      console.error("Recognition start error:", err);
      setListening(false);
    }
  );
}

function stopListening() {
  if (!speechRecognizer) return;

  speechRecognizer.stopContinuousRecognitionAsync(
    () => {
      speechRecognizer.close();
      speechRecognizer = null;
      setListening(false);
      clearCaption();
    },
    err => {
      console.error("Recognition stop error:", err);
      setListening(false);
    }
  );
}

function bindUi() {
  $("startSession")?.addEventListener("click", connectAvatar);
  $("stopSession")?.addEventListener("click", disconnectAvatar);
  $("stopSpeaking")?.addEventListener("click", stopSpeaking);
  $("submitTurn")?.addEventListener("click", () => sendPanelTurn());

  $("activeSpeaker")?.addEventListener("change", e => {
    state.activeSpeaker = e.target.value;
  });

  $("responseMode")?.addEventListener("change", e => {
    state.responseMode = e.target.value;
  });

  $("idleOverlay")?.addEventListener("click", async () => {
    if (!sessionActive) {
      await connectAvatar();
      startListening();
    }
  });

  document.addEventListener("keydown", async e => {
    if (e.code === "Space" && !sessionActive) {
      e.preventDefault();
      await connectAvatar();
      startListening();
    }

    if (e.code === "Escape") {
      stopSpeaking();
      stopListening();
    }
  });

  $("userMessageBox")?.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPanelTurn();
    }
  });
}

window.addEventListener("load", async () => {
  bindUi();
  await loadConfig();
  if ($("sessionStatus")) $("sessionStatus").textContent = "Ready";
});