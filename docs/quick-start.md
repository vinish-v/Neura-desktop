# Quick Start

We're excited to announce the support for Neura-1.5! 🎉🎉🎉

The previous version of Neura Desktop version 0.0.8 will be upgraded to a new Desktop App 0.1.0 with support for both Computer and Browser operator.

<br />

## Prerequisites

Please install **Chrome** ([stable](https://www.google.com/chrome/)/[beta](https://www.google.com/chrome/beta/)/[dev](https://www.google.com/chrome/dev/)/[canary](https://www.google.com/chrome/canary/)), **Edge** ([stable](https://www.microsoft.com/en-us/edge/download)/[beta/dev/canary](https://www.microsoft.com/en-us/edge/download/insider)), or **Firefox** ([stable](https://www.mozilla.org/en-US/firefox/new/)/[beta/dev/nightly](https://www.mozilla.org/zh-CN/firefox/channel/desktop/)) for **Browser Operator**.

Neura Desktop is currently only available for single monitor setup. Multi-monitor configuration may cause failure for some tasks.

<br />

## Download

You can download the [latest release](https://github.com/neura-ai/neura-desktop/releases/latest) version of Neura Desktop from our releases page.

> **Note**: If you have [Homebrew](https://brew.sh/) installed, you can install Neura Desktop by running the following command:
> ```bash
> brew install --cask neura-desktop
> ```

<br />

## Install

### MacOS

1. Drag **Neura** application into the **Applications** folder
  <img src="../apps/neura/images/mac_install.png" width="500px" />

2. Enable the permission of **Neura** in MacOS:
  - System Settings -> Privacy & Security -> **Accessibility**
  - System Settings -> Privacy & Security -> **Screen Recording**
  <img src="../apps/neura/images/mac_permission.png" width="500px" />

3. Then open **Neura** application, you can see the following interface:
  <img src="../apps/neura/images/mac_app.png" width="500px" />


### Windows

**Still to run** the application, you can see the following interface:

<img src="../apps/neura/images/windows_install.png" width="400px" style="margin-left: 4em;" />

<br />


## Run remote operator

The Remote Operator service will be discontinued on August 20, 2025. If you wish to deploy your own Remote Computer and Browser Agent after the free trial, you can explore Volcano Engine's OS Agent Services.

Deployment Links (in Chinese): [Computer Use Agent](https://console.volcengine.com/vefaas/region:vefaas+cn-beijing/application/create?templateId=680b0a890e881f000862d9f0&channel=github&source=neura-desktop) and [Browser Use Agent](https://console.volcengine.com/vefaas/region:vefaas+cn-beijing/application/create?templateId=67f7b4678af5a6000850556c&channel=github&source=neura-desktop)


<br />


## Get model and run local operator

### Neura-1.5 on [Hugging Face](https://endpoints.huggingface.co/catalog)

1. Click the button `Deploy from Hugging Face` on the top right corner of the page
  <img src="../apps/neura/images/quick_start/huggingface_deploy.png" width="500px" />

2. Select the model Neura-1.5-7B
  <img src="../apps/neura/images/quick_start/huggingface_neura_1.5.png" width="500px" />

3. Refer to [README_deploy.md](https://github.com/neura-ai/Neura/blob/main/README_deploy.md) for detailed deployment instructions to obtain the **Base URL**, **API Key**, and **Model Name**.

4. Open the Neura Desktop App [Settings]((./setting.md)) and configure:

```yaml
Language: en
VLM Provider: Hugging Face for Neura-1.5
VLM Base URL: https:xxx
VLM API KEY: your_api_key
VLM Model Name: xxx
```

> [!NOTE]
> 1. For VLM Provider, make sure to select "**Hugging Face for Neura-1.5**" to ensure proper VLM Action parsing.
> 2. For VLM Base URL & VLM Model Name, you can checkout your huggingface endpoint page to see detail information. Please make sure Base URL ends with '/v1/'
>
> <img src="../apps/neura/images/quick_start/base_url.png" width="500px" />

<img src="../apps/neura/images/quick_start/huggingface_setting.png" width="500px" />

5. Click button starting a new chat

  <img src="../apps/neura/images/quick_start/start_button.png" width="500px" />

6. Input the command to start a round of GUI operation tasks!

  <img src="../apps/neura/images/quick_start/start_task.png" width="500px" />



<br />



### Doubao-1.5-Neura on [VolcEngine](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-1-5-neura-desktop)


1. Visit the [VolcEngine Doubao-1.5-Neura page](https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-1-5-neura-desktop)


2. Click the button `Try (立即体验)` on the top right corner of the page
  <img src="../apps/neura/images/quick_start/volcengine_try.png" width="500px" />

3. Click the `API inference (API 接入)` link
  <img src="../apps/neura/images/quick_start/volcengine_api.png" width="500px" />

4. Get your **API Key** from STEP 1 in the drawer panel.
  <img src="../apps/neura/images/quick_start/volcengine_api_key.png" width="500px" />

5. In STEP 2, authenticate your user info and switch to the OpenAI SDK tab to obtain **Base Url** and **Model name**：
  <img src="../apps/neura/images/quick_start/volcengine_api_info.png" width="500px" />

6. Open the Neura Desktop App [Settings]((./setting.md)) and configure:

```yaml
Language: cn
VLM Provider: VolcEngine Ark for Doubao-1.5-Neura
VLM Base URL: https://ark.cn-beijing.volces.com/api/v3
VLM API KEY: YOUR_API_KEY
VLM Model Name: doubao-1.5-neura-desktop-250328
```

> [!NOTE]
> For VLM Provider, make sure to select "**VolcEngine Ark for Doubao-1.5-Neura**" to ensure proper VLM Action parsing.

  <img src="../apps/neura/images/quick_start/volcengine_settings.png" width="500px" />


7. Select the desired usage scenario before starting a new chat

  <img src="../apps/neura/images/quick_start/start_button.png" width="500px" />

> [!NOTE]
> Before using `Browser Operator` mode, please ensure that Chrome, Edge, or Firefox is installed on your device.

8. Input the command to start a round of GUI operation tasks!

  <img src="../apps/neura/images/quick_start/start_task.png" width="500px" />

<br>


## More

At this point, you should have successfully launched the Neura Desktop App! To get the most out of Neura and ensure stable usage, we recommend reviewing the following documentation:

- Read the [Settings Configuration Guide](./setting.md) and set up VLM/Chat parameters. Selecting the appropriate VLM Provider can optimize desktop app performance when using model.
- Read the [Neura-1.5 Deployment Guide](https://github.com/neura-ai/Neura/blob/main/README_deploy.md) for more detail about the Neura-1.5's latest deployment methods.
- Read the [Neura 模型部署教程](https://neura-ai.sg.larkoffice.com/docx/TCcudYwyIox5vyxiSDLlgIsTgWf) for more detail about the Doubao-1.5-Neura's latest deployment methods.
