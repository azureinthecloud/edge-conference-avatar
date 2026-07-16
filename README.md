# Edge Conference AI Co-Host — Live Avatar Demo

## What this is
A static web app + two Azure Functions API routes that run a live, talking AI avatar
(Azure AI Speech) wired to Azure OpenAI, deployable directly to Azure Static Web Apps.

## Folder structure
```
/                      <- static site root (index.html, config.js, app.js)
/api/get-config        <- Azure Function, returns non-secret avatar config
/api/chat              <- Azure Function, calls Azure OpenAI server-side
staticwebapp.config.json
```

## Setup steps

1. Create these Azure resources (if not already done):
   - Speech resource (Standard S0 tier) in a supported region:
     Southeast Asia, North Europe, West Europe, Sweden Central,
     South Central US, East US 2, West US 2.
   - Azure OpenAI resource with a gpt-4o deployment.
   - REGENERATE any keys that were ever pasted outside the Azure Portal.

2. Push this folder to a GitHub repo.

3. In Azure Portal, create a Static Web App resource:
   - Connect it to your GitHub repo.
   - App location: "/"
   - Api location: "api"
   - Output location: "" (leave blank)

4. After deployment, go to your Static Web App resource in the Azure Portal:
   - Configuration blade -> Application settings -> add:
     SPEECH_KEY = <your speech key>
     SPEECH_REGION = <e.g. eastus2>
     OPENAI_ENDPOINT = <https://your-resource.openai.azure.com>
     OPENAI_DEPLOYMENT = gpt-4o
     OPENAI_API_VERSION = 2024-02-15-preview
     OPENAI_KEY = <your azure openai key>
   - Save. These are stored securely server-side, never shipped to the browser.

5. Visit your Static Web App URL. Click "Start Avatar", then "Hold to Talk"
   to speak to it, it transcribes your speech, sends it to Azure OpenAI,
   and speaks the reply back through the avatar.

## Before the event — test on venue network
Real-time avatar uses WebRTC and needs outbound access to:
  - UDP 3478 to relay.communication.microsoft.com
  - TCP 443 to relay.communication.microsoft.com
Test this from the actual venue Wi-Fi in advance. If blocked, fall back to
a pre-rendered avatar video instead (Speech Studio "Text to speech avatar" tool).

## Security notes
- Never commit real keys into config.js or any file in source control.
- config.js is only a local dev fallback; production reads keys via /api/get-config
  and /api/chat, both of which pull secrets from server-side Application Settings.
- Since keys were previously shared in chat, regenerate them in the Azure Portal
  before using this code.
