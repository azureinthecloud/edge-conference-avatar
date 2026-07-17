let peerConnection;
let avatarSynthesizer;
let speechConfig;
let continuousRecognizer = null;
let isProcessing = false;
let cfg;

const captionBar = document.getElementById("captionBar");
const listeningIndicator = document.getElementById("listeningIndicator");
const idleOverlay = document.getElementById("idleOverlay");
const remoteVideoDiv = document.getElementById("remoteVideo");

const WAKE_WORD_REGEX = /\b(hey\s+)?(kiri)\b(.*)/i;

const SCRIPTED_RESPONSES = [
  {
    triggers: ["jet lag", "long flight", "tired"],
    reply: "Oh please, I've been awake since this app deployed. Try running on zero sleep and a WebRTC connection, then we'll talk."
  },
  {
    triggers: ["what do you think of new zealand", "new zealand", "nz"],
    reply: "Kiwi hospitality, questionable weather, and I finally get an accent that matches my name. I'm thriving."
  },
  {
    triggers: ["are you real", "are you human", "are you alive"],
    reply: "Define real. I've got better uptime than most people after lunch."
  }
];

function checkScriptedResponse(userText) {
  const lower = userText.toLowerCase();
  for (const entry of SCRIPTED_RESPONSES) {
    if (entry.triggers.some(trigger => lower.includes(trigger))) {
      return entry.reply;
    }
  }
  return null;
}

function showCaption(text, autohideMs) {
  captionBar.textContent = text;
  captionBar.classList.add("show");
  if (autohideMs) {
    clearTimeout(captionBar._t);
    captionBar._t = setTimeout(() => captionBar.classList.remove("show"), autohideMs);
  }
}

async function getConfig() {
  try {
    const res = await fetch("/api/get-config");
    if (res.ok) return await res.json();
  } catch (e) {
    console.log("Falling back to local config.js (dev only)");
  }
  return window.APP_CONFIG;
}

async function fetchIceToken(speechKey, speechRegion) {
  const res = await fetch(
    `https://${speechRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`,
    { headers: { "Ocp-Apim-Subscription-Key": speechKey } }
  );
  if (!res.ok) throw new Error("Failed to fetch ICE token: " + res.status);
  return await res.json();
}

async function startAvatar() {
  idleOverlay.style.display = "none";
  cfg = await getConfig();
  if (!cfg.SPEECH_KEY || !cfg.SPEECH_REGION) {
    showCaption("Missing Speech key/region config.", 5000);
    return;
  }

  const ice = await fetchIceToken(cfg.SPEECH_KEY, cfg.SPEECH_REGION);

  peerConnection = new RTCPeerConnection({
    iceServers: [{
      urls: [ice.Urls[0]],
      username: ice.Username,
      credential: ice.Password
    }]
  });

  remoteVideoDiv.innerHTML = "";

  peerConnection.ontrack = function (event) {
    if (event.track.kind === "video") {
      const videoEl = document.createElement("video");
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      videoEl.srcObject = event.streams[0];
      remoteVideoDiv.appendChild(videoEl);
    }
    if (event.track.kind === "audio") {
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioEl.srcObject = event.streams[0];
      remoteVideoDiv.appendChild(audioEl);
    }
  };

  peerConnection.addTransceiver("video", { direction: "sendrecv" });
  peerConnection.addTransceiver("audio", { direction: "sendrecv" });

  speechConfig = SpeechSDK.SpeechConfig.fromSubscription(cfg.SPEECH_KEY, cfg.SPEECH_REGION);
  speechConfig.speechSynthesisVoiceName = cfg.VOICE_NAME;

  const avatarConfig = new SpeechSDK.AvatarConfig(cfg.AVATAR_CHARACTER, cfg.AVATAR_STYLE);
  avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);

  await avatarSynthesizer.startAvatarAsync(peerConnection);

  if (cfg.GREETING_LINE) {
    await avatarSynthesizer.speakTextAsync(cfg.GREETING_LINE);
  }

  startWakeWordListening();
}

async function sendToGPT(userText) {
  stopWakeWordListening();
  isProcessing = true;
  listeningIndicator.classList.remove("active");

  showCaption('Kiri heard: "' + userText + '"', null);

  try {
    const scripted = checkScriptedResponse(userText);

    if (scripted) {
      showCaption(scripted, null);
      await avatarSynthesizer.speakTextAsync(scripted);
      setTimeout(() => captionBar.classList.remove("show"), 3000);
    } else {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userText, systemPrompt: cfg.SYSTEM_PROMPT })
      });

      if (!res.ok) {
        showCaption("Hmm, having trouble thinking of a reply.", 4000);
      } else {
        const data = await res.json();
        const replyText = data.reply;
        showCaption(replyText, null);
        await avatarSynthesizer.speakTextAsync(replyText);
        setTimeout(() => captionBar.classList.remove("show"), 3000);
      }
    }
  } catch (err) {
    showCaption("Error: " + err.message, 5000);
  }

  isProcessing = false;
  startWakeWordListening();
}

function startWakeWordListening() {
  if (!speechConfig || continuousRecognizer) return;

  const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
  continuousRecognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

  const phraseList = SpeechSDK.PhraseListGrammar.fromRecognizer(continuousRecognizer);
  phraseList.addPhrase("Kiri");
  phraseList.addPhrase("Hey Kiri");

  continuousRecognizer.recognized = (s, e) => {
    if (isProcessing) return;
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
      const transcript = e.result.text;
      if (!transcript) return;

      console.log("Heard:", transcript);
      const match = transcript.match(WAKE_WORD_REGEX);

      if (match) {
        listeningIndicator.classList.add("active");
        const question = match[3] && match[3].trim() ? match[3].trim() : transcript;
        sendToGPT(question);
      }
    }
  };

  continuousRecognizer.startContinuousRecognitionAsync(
    () => console.log("Wake-word listening started."),
    (err) => console.log("Failed to start continuous recognition:", err)
  );
}

function stopWakeWordListening() {
  if (!continuousRecognizer) return;
  const recognizerToClose = continuousRecognizer;
  continuousRecognizer = null;

  recognizerToClose.stopContinuousRecognitionAsync(
    () => recognizerToClose.close(),
    (err) => {
      console.log("Error stopping recognizer:", err);
      recognizerToClose.close();
    }
  );
}

function stopAvatar() {
  stopWakeWordListening();
  if (avatarSynthesizer) avatarSynthesizer.close();
  if (peerConnection) peerConnection.close();
  remoteVideoDiv.innerHTML = "";
  idleOverlay.style.display = "flex";
}

idleOverlay.addEventListener("click", () => {
  startAvatar().catch(err => showCaption("Error: " + err.message, 8000));
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && idleOverlay.style.display !== "none") {
    e.preventDefault();
    startAvatar().catch(err => showCaption("Error: " + err.message, 8000));
  }
  if (e.code === "Escape") {
    stopAvatar();
  }
});