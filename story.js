const STORY_URL_PREFIX = "https://www.facebook.com/stories/";
const TARGET_SELECTOR = ".x11lhmoz.x78zum5.x1q0g3np.xsdox4t.xbudbmw.x10l6tqk.xwa60dl.xl56j7k.xtuxyv6";

let isUIEnabled = true;
let reactContainer = null;
let domObserver = null;
let currentUrl = location.href;
let pollingIntervalId = null;
let historyPatched = false;
let lastStoryId = null;
let cachedDtsg = null;

chrome.storage.local.get({ showInPageUI: true }, (data) => {
  isUIEnabled = Boolean(data.showInPageUI);
  startUrlObserver();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "PING") {
    sendResponse({ status: "ok" });
    return false;
  }

  if (msg.action === "GET_PAGE_CONTEXT") {
    sendResponse({
      status: "ok",
      theme: isDarkMode() ? "dark" : "light"
    });
    return false;
  }

  if (msg.action === "TRIGGER_REACTION") {
    handleReactionRequest(msg.payload, sendResponse);
    return true;
  }

  if (msg.action === "TOGGLE_UI") {
    isUIEnabled = Boolean(msg.payload);

    if (isUIEnabled) {
      if (location.href.startsWith(STORY_URL_PREFIX)) {
        init();
      }
    } else {
      stopDomObserver();
      if (reactContainer?.isConnected) {
        reactContainer.remove();
      }
    }

    sendResponse({ status: "ok" });
    return false;
  }

  return false;
});

function handleReactionRequest(emoji, sendResponse) {
  const storyId = getStoryId();
  const fbDtsg = getFbdtsg();
  const userId = getUserId();

  if (!storyId || !fbDtsg || !userId) {
    sendResponse({
      status: "error",
      message: "Không tìm thấy dữ liệu story hiện tại. Hãy tải lại trang story rồi thử lại."
    });
    return;
  }

  reactStory(userId, fbDtsg, storyId, emoji)
    .then(() => sendResponse({ status: "success" }))
    .catch((error) => {
      sendResponse({
        status: "error",
        message: getReadableError(error)
      });
    });
}

function startUrlObserver() {
  if (!historyPatched) {
    const originalPush = history.pushState;
    const originalReplace = history.replaceState;

    history.pushState = function (...args) {
      const result = originalPush.apply(this, args);
      queueUrlCheck();
      return result;
    };

    history.replaceState = function (...args) {
      const result = originalReplace.apply(this, args);
      queueUrlCheck();
      return result;
    };

    window.addEventListener("popstate", queueUrlCheck);
    historyPatched = true;
  }

  if (!pollingIntervalId) {
    pollingIntervalId = setInterval(() => {
      if (location.href !== currentUrl) {
        currentUrl = location.href;
        handleUrlChange();
      }
    }, 500);
  }

  handleUrlChange();
}

function queueUrlCheck() {
  setTimeout(() => {
    if (location.href !== currentUrl) {
      currentUrl = location.href;
      handleUrlChange();
    }
  }, 0);
}

function handleUrlChange() {
  if (!currentUrl.startsWith(STORY_URL_PREFIX)) {
    stopDomObserver();
    return;
  }

  if (isUIEnabled) {
    init();
  }
}

async function init() {
  if (domObserver) {
    return;
  }

  try {
    const emojiUrl = chrome.runtime.getURL("db/emoji.json");
    const response = await fetch(emojiUrl);
    const emojiList = await response.json();

    if (!reactContainer) {
      createReactContainer(emojiList);
      const button = reactContainer.querySelector(".btn-react");
      if (button) {
        button.classList.add("slide-in");
        setTimeout(() => button.classList.remove("slide-in"), 700);
      }
    }

    startDomObserver();
  } catch (error) {
    console.error("Failed to initialize story controls:", error);
  }
}

function createReactContainer(emojiList) {
  reactContainer = document.createElement("div");
  reactContainer.className = "react-container";

  const btnReact = document.createElement("div");
  btnReact.className = "btn-react";
  btnReact.textContent = "MORE";

  const btnChangeBg = document.createElement("button");
  btnChangeBg.className = "btn-bg";
  btnChangeBg.type = "button";
  btnChangeBg.innerHTML = "<span class='btn-icon'>🖼️</span>";

  const btnResetBg = document.createElement("button");
  btnResetBg.className = "btn-reset";
  btnResetBg.type = "button";
  btnResetBg.innerHTML = "<span class='btn-icon'>↻</span>";

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";

  const emojiGroup = document.createElement("ul");
  emojiGroup.className = "emoji-group";
  emojiGroup.addEventListener("wheel", (event) => event.stopPropagation(), { passive: true });

  restoreSavedBackground(emojiGroup);

  fileInput.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      emojiGroup.style.backgroundImage = `url(${reader.result})`;
      emojiGroup.style.backgroundSize = "cover";
      emojiGroup.style.backgroundPosition = "center";
      emojiGroup.style.backgroundColor = "transparent";
      localStorage.setItem("emojiPopupBg", String(reader.result));
    };
    reader.readAsDataURL(file);
  });

  btnChangeBg.addEventListener("click", (event) => {
    event.stopPropagation();
    fileInput.click();
  });

  btnResetBg.addEventListener("click", (event) => {
    event.stopPropagation();
    emojiGroup.style.backgroundImage = "none";
    emojiGroup.style.backgroundColor = isDarkMode() ? "rgba(40,40,40,0.9)" : "rgba(255,255,255,0.75)";
    localStorage.removeItem("emojiPopupBg");
  });

  btnReact.addEventListener("click", () => {
    const visible = emojiGroup.classList.toggle("emoji-group--show");
    reactContainer.classList.toggle("react-container--expanded", visible);
    setActionButtonsState(btnChangeBg, btnResetBg, !visible);

    if (visible) {
      const onDone = (event) => {
        if (event.target !== btnResetBg) {
          return;
        }
        setActionButtonsState(btnChangeBg, btnResetBg, false);
        btnResetBg.removeEventListener("transitionend", onDone);
      };

      btnResetBg.addEventListener("transitionend", onDone);
    }
  });

  emojiList.forEach((emoji) => {
    const item = document.createElement("li");
    item.className = "emoji";
    item.textContent = emoji.value;
    item.addEventListener("click", async () => {
      const storyId = getStoryId();
      const fbDtsg = getFbdtsg();
      const userId = getUserId();

      if (!storyId || !fbDtsg || !userId) {
        return;
      }

      try {
        await reactStory(userId, fbDtsg, storyId, emoji.value);
      } catch (error) {
        console.error("Failed to send reaction from inline panel:", error);
      }
    });
    emojiGroup.appendChild(item);
  });

  document.addEventListener("contextmenu", (event) => {
    if (reactContainer?.contains(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  reactContainer.appendChild(btnReact);
  reactContainer.appendChild(btnChangeBg);
  reactContainer.appendChild(btnResetBg);
  reactContainer.appendChild(fileInput);
  reactContainer.appendChild(emojiGroup);

  reactContainer.addEventListener("mouseenter", () => {
    document.querySelectorAll("video").forEach((video) => video.pause());
  });

  reactContainer.addEventListener("mouseleave", () => {
    document.querySelectorAll("video").forEach((video) => video.play());
  });
}

function startDomObserver() {
  const tryInject = () => {
    if (!reactContainer) {
      return;
    }

    const currentStoryId = getStoryId();
    if (currentStoryId && currentStoryId !== lastStoryId) {
      if (reactContainer.isConnected) {
        reactContainer.remove();
      }
      lastStoryId = currentStoryId;
    }

    const primaryTarget = document.querySelector(TARGET_SELECTOR);
    const target = primaryTarget || document.querySelector(".YOUR_FALLBACK_SELECTOR");
    if (!target || reactContainer.isConnected) {
      return;
    }

    try {
      target.appendChild(reactContainer);
    } catch (error) {
      console.error("Failed to inject story controls:", error);
    }
  };

  tryInject();
  domObserver = new MutationObserver(tryInject);

  const observeTarget = document.body || document.documentElement;
  if (observeTarget) {
    domObserver.observe(observeTarget, {
      childList: true,
      subtree: true
    });
  }
}

function stopDomObserver() {
  if (domObserver) {
    try {
      domObserver.disconnect();
    } catch (error) {
      console.warn("Failed to disconnect DOM observer:", error);
    }
    domObserver = null;
  }

  if (reactContainer?.parentNode) {
    reactContainer.parentNode.removeChild(reactContainer);
  }
}

function setActionButtonsState(btnChangeBg, btnResetBg, disabled) {
  btnChangeBg.disabled = disabled;
  btnResetBg.disabled = disabled;
  btnChangeBg.style.pointerEvents = disabled ? "none" : "auto";
  btnResetBg.style.pointerEvents = disabled ? "none" : "auto";
}

function restoreSavedBackground(emojiGroup) {
  const savedBg = localStorage.getItem("emojiPopupBg");
  if (!savedBg) {
    return;
  }

  emojiGroup.style.backgroundImage = `url(${savedBg})`;
  emojiGroup.style.backgroundSize = "cover";
  emojiGroup.style.backgroundPosition = "center";
  emojiGroup.style.backgroundColor = "transparent";
}

function getStoryId() {
  const elements = document.getElementsByClassName("xh8yej3 x1n2onr6 xl56j7k x5yr21d x78zum5 x6s0dn4");
  return elements.length ? elements[elements.length - 1].getAttribute("data-id") : null;
}

function getFbdtsg() {
  if (cachedDtsg) {
    return cachedDtsg;
  }

  const match = /"DTSGInitialData".+?"token":"(.+?)"/.exec(document.documentElement.innerHTML);
  cachedDtsg = match?.[1] || null;
  return cachedDtsg;
}

function getUserId() {
  const match = /c_user=(\d+);/gm.exec(document.cookie);
  return match ? match[1] : null;
}

async function reactStory(userId, fbDtsg, storyId, emoji) {
  const variables = {
    input: {
      lightweight_reaction_actions: {
        offsets: [0],
        reaction: emoji
      },
      story_id: storyId,
      story_reply_type: "LIGHT_WEIGHT",
      actor_id: userId,
      client_mutation_id: 7
    }
  };

  const body = new URLSearchParams();
  body.append("av", userId);
  body.append("__user", userId);
  body.append("__a", 1);
  body.append("fb_dtsg", fbDtsg);
  body.append("fb_api_caller_class", "RelayModern");
  body.append("fb_api_req_friendly_name", "useStoriesSendReplyMutation");
  body.append("variables", JSON.stringify(variables));
  body.append("server_timestamps", true);
  body.append("doc_id", "3769885849805751");

  const response = await fetch("https://www.facebook.com/api/graphql/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const json = await response.json();
  if (json.errors) {
    throw json.errors;
  }

  return json;
}

function getReadableError(error) {
  if (Array.isArray(error) && error[0]?.message) {
    return error[0].message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  try {
    return JSON.stringify(error);
  } catch (serializationError) {
    return "Không thể gửi reaction.";
  }
}

function isDarkMode() {
  const htmlClass = document.documentElement.className;
  return (
    htmlClass.includes("dark") ||
    htmlClass.includes("theme_dark") ||
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}
