const FACEBOOK_ORIGIN = "https://www.facebook.com/";
const STORY_PATH_TOKEN = "/stories/";
const RECENT_EMOJIS_LIMIT = 12;
const AUDIO_DB_NAME = "popup-media-db";
const AUDIO_STORE_NAME = "tracks";
const AUDIO_STATE_KEY = "audioPlaybackState";

const state = {
  activeTab: null,
  allEmojis: [],
  filteredEmojis: [],
  recentEmojis: [],
  isOnFacebook: false,
  isOnStory: false,
  isPopupBusy: false,
  pageTheme: "light",
  effectiveTheme: "light",
  themePreference: "auto",
  popupBackground: "",
  audioTracks: [],
  currentTrackIndex: -1,
  isAudioPlaying: false,
  currentTrackUrl: "",
  audioVolume: 1,
  audioDuration: 0,
  audioPosition: 0,
  audioRestoreState: null
};

const elements = {};

document.addEventListener("DOMContentLoaded", async () => {
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  cacheElements();
  bindTabs();
  bindActions();
  bindThemeSync();
  await Promise.all([loadEmojis(), loadSettings(), refreshActiveTabState()]);
  renderRecentEmojis();
  renderEmojiGrid();
});

function cacheElements() {
  elements.tabs = document.querySelectorAll(".tab");
  elements.contents = document.querySelectorAll(".content");
  elements.grid = document.getElementById("emoji-grid");
  elements.recentList = document.getElementById("recent-list");
  elements.search = document.getElementById("emoji-search");
  elements.message = document.getElementById("message");
  elements.toggle = document.getElementById("toggle-ui");
  elements.pageStatus = document.getElementById("page-status");
  elements.pageMeta = document.getElementById("page-meta");
  elements.refreshStatus = document.getElementById("refresh-status");
  elements.openStory = document.getElementById("open-story");
  elements.themeModeToggle = document.getElementById("theme-mode-toggle");
  elements.themeModeHelp = document.getElementById("theme-mode-help");
  elements.changeBackground = document.getElementById("change-background");
  elements.resetBackground = document.getElementById("reset-background");
  elements.backgroundFile = document.getElementById("background-file");
  elements.backgroundHelp = document.getElementById("background-help");
  elements.audioFile = document.getElementById("audio-file");
  elements.addAudio = document.getElementById("add-audio");
  elements.clearAudio = document.getElementById("clear-audio");
  elements.audioPlayer = document.getElementById("audio-player");
  elements.audioList = document.getElementById("audio-list");
  elements.audioCurrent = document.getElementById("audio-current");
  elements.audioPlay = document.getElementById("audio-play");
  elements.audioPrev = document.getElementById("audio-prev");
  elements.audioNext = document.getElementById("audio-next");
  elements.audioHelp = document.getElementById("audio-help");
  elements.audioCount = document.getElementById("audio-count");
  elements.audioProgress = document.getElementById("audio-progress");
  elements.audioCurrentTime = document.getElementById("audio-current-time");
  elements.audioDuration = document.getElementById("audio-duration");
  elements.audioVolume = document.getElementById("audio-volume");
  elements.audioVolumeValue = document.getElementById("audio-volume-value");
}

function bindTabs() {
  elements.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      elements.tabs.forEach((item) => item.classList.remove("active"));
      elements.contents.forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");
      document.getElementById(tab.dataset.target).classList.add("active");
    });
  });
}

function bindActions() {
  elements.search.addEventListener("input", () => {
    filterEmojis(elements.search.value);
    renderEmojiGrid();
  });

  elements.refreshStatus.addEventListener("click", async () => {
    await refreshActiveTabState(true);
  });

  elements.toggle.addEventListener("change", async () => {
    const enabled = elements.toggle.checked;
    chrome.storage.local.set({ showInPageUI: enabled });

    if (!state.isOnFacebook) {
      setMessage("Đã lưu cài đặt. Mở Facebook để áp dụng giao diện nổi.", "warning");
      return;
    }

    const response = await sendCommand("TOGGLE_UI", enabled);
    if (response?.status === "ok") {
      setMessage(
        enabled
          ? "Đã bật giao diện nổi trên trang Facebook."
          : "Đã tắt giao diện nổi trên trang Facebook.",
        "success"
      );
    } else {
      setMessage("Đã lưu cài đặt, nhưng tab hiện tại chưa nhận được lệnh. Hãy tải lại trang Facebook.", "warning");
    }
  });

  elements.openStory.addEventListener("click", () => {
    chrome.tabs.create({ url: `${FACEBOOK_ORIGIN}stories/create/` });
  });

  elements.themeModeToggle.addEventListener("click", async () => {
    state.themePreference = getNextThemePreference(state.themePreference);
    await chrome.storage.local.set({ themePreference: state.themePreference });
    await refreshPageTheme();
    updateThemeModeUI();
    applyEffectiveTheme();
  });

  elements.changeBackground.addEventListener("click", () => {
    elements.backgroundFile.click();
  });

  elements.backgroundFile.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const dataUrl = await createPopupBackgroundImage(file);
    state.popupBackground = dataUrl;
    await chrome.storage.local.set({ popupBackground: dataUrl });
    applyPopupBackground();
    updateBackgroundUI();
    setMessage("Đã lưu ảnh nền cho popup.", "success");
    event.target.value = "";
  });

  elements.resetBackground.addEventListener("click", async () => {
    state.popupBackground = "";
    await chrome.storage.local.remove("popupBackground");
    applyPopupBackground();
    updateBackgroundUI();
    setMessage("Đã xóa ảnh nền và trở về nền mặc định.", "success");
  });

  elements.addAudio.addEventListener("click", () => {
    elements.audioFile.click();
  });

  elements.audioFile.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      return;
    }

    await addAudioFiles(files);
    event.target.value = "";
  });

  elements.clearAudio.addEventListener("click", async () => {
    await clearAudioPlaylist();
  });

  elements.audioPlay.addEventListener("click", async () => {
    if (state.audioTracks.length === 0) {
      return;
    }

    if (state.currentTrackIndex < 0) {
      await selectTrack(0, true);
      return;
    }

    if (state.isAudioPlaying) {
      elements.audioPlayer.pause();
    } else {
      await elements.audioPlayer.play();
    }
  });

  elements.audioPrev.addEventListener("click", async () => {
    if (state.audioTracks.length === 0) {
      return;
    }

    const nextIndex = state.currentTrackIndex <= 0 ? state.audioTracks.length - 1 : state.currentTrackIndex - 1;
    await selectTrack(nextIndex, true);
  });

  elements.audioNext.addEventListener("click", async () => {
    if (state.audioTracks.length === 0) {
      return;
    }

    const nextIndex = state.currentTrackIndex >= state.audioTracks.length - 1 ? 0 : state.currentTrackIndex + 1;
    await selectTrack(nextIndex, true);
  });

  elements.audioPlayer.addEventListener("play", () => {
    state.isAudioPlaying = true;
    updateAudioUI();
    persistAudioPlaybackState();
  });

  elements.audioPlayer.addEventListener("pause", () => {
    state.isAudioPlaying = false;
    updateAudioUI();
    persistAudioPlaybackState();
  });

  elements.audioPlayer.addEventListener("ended", async () => {
    state.audioPosition = 0;
    persistAudioPlaybackState();
    if (state.audioTracks.length === 0) {
      return;
    }

    const nextIndex = state.currentTrackIndex >= state.audioTracks.length - 1 ? 0 : state.currentTrackIndex + 1;
    await selectTrack(nextIndex, true);
  });

  elements.audioPlayer.addEventListener("error", () => {
    setMessage("File nhạc này không phát được trong Chromium. Hãy thử định dạng khác.", "error");
  });

  elements.audioPlayer.addEventListener("loadedmetadata", () => {
    state.audioDuration = Number.isFinite(elements.audioPlayer.duration) ? elements.audioPlayer.duration : 0;

    if (state.audioRestoreState && state.audioRestoreState.trackId === state.audioTracks[state.currentTrackIndex]?.id) {
      const safeTime = Math.min(state.audioRestoreState.position || 0, Math.max(state.audioDuration - 0.25, 0));
      elements.audioPlayer.currentTime = safeTime;
      state.audioPosition = safeTime;
      const shouldResumePlayback = state.audioRestoreState.wasPlaying;
      state.audioRestoreState = null;

      if (shouldResumePlayback) {
        elements.audioPlayer.play().catch(() => {
          state.isAudioPlaying = false;
          updateAudioUI();
        });
      }
    }

    updateAudioUI();
  });

  elements.audioPlayer.addEventListener("timeupdate", () => {
    state.audioPosition = Number.isFinite(elements.audioPlayer.currentTime) ? elements.audioPlayer.currentTime : 0;
    state.audioDuration = Number.isFinite(elements.audioPlayer.duration) ? elements.audioPlayer.duration : 0;
    updateAudioProgressUI();
    persistAudioPlaybackState();
  });

  elements.audioProgress.addEventListener("input", () => {
    const duration = Number.isFinite(elements.audioPlayer.duration) ? elements.audioPlayer.duration : 0;
    const progress = Number(elements.audioProgress.value) / 100;
    state.audioPosition = duration * progress;
    updateAudioProgressUI();
  });

  elements.audioProgress.addEventListener("change", () => {
    const duration = Number.isFinite(elements.audioPlayer.duration) ? elements.audioPlayer.duration : 0;
    if (duration <= 0) {
      return;
    }

    const progress = Number(elements.audioProgress.value) / 100;
    const nextTime = duration * progress;
    elements.audioPlayer.currentTime = nextTime;
    state.audioPosition = nextTime;
    persistAudioPlaybackState();
    updateAudioProgressUI();
  });

  elements.audioVolume.addEventListener("input", async () => {
    state.audioVolume = Number(elements.audioVolume.value) / 100;
    elements.audioPlayer.volume = state.audioVolume;
    updateAudioVolumeUI();
    await persistAudioPlaybackState();
  });

  window.addEventListener("beforeunload", () => {
    persistAudioPlaybackState();
  });
}

function bindThemeSync() {
  chrome.tabs.onActivated.addListener(() => {
    refreshActiveTabState();
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!state.activeTab?.id || tabId !== state.activeTab.id) {
      return;
    }

    if (changeInfo.status === "complete" || typeof changeInfo.url === "string") {
      refreshActiveTabState();
    }
  });

  window.addEventListener("focus", () => {
    refreshActiveTabState();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      refreshActiveTabState();
    }
  });
}

async function loadEmojis() {
  try {
    const response = await fetch("db/emoji.json");
    const emojis = await response.json();
    state.allEmojis = Array.isArray(emojis) ? emojis : [];
    state.filteredEmojis = [...state.allEmojis];
    updateControls();
  } catch (error) {
    state.allEmojis = [];
    state.filteredEmojis = [];
    setMessage("Không thể tải danh sách emoji.", "error");
    updateControls();
  }
}

async function loadSettings() {
  const data = await chrome.storage.local.get({
    showInPageUI: true,
    recentEmojis: [],
    themePreference: "auto",
    popupBackground: "",
    [AUDIO_STATE_KEY]: null
  });
  elements.toggle.checked = Boolean(data.showInPageUI);
  state.recentEmojis = Array.isArray(data.recentEmojis) ? data.recentEmojis.slice(0, RECENT_EMOJIS_LIMIT) : [];
  state.themePreference = normalizeThemePreference(data.themePreference);
  state.popupBackground = typeof data.popupBackground === "string" ? data.popupBackground : "";
  state.audioRestoreState = normalizeAudioPlaybackState(data[AUDIO_STATE_KEY]);
  state.audioVolume = state.audioRestoreState?.volume ?? 1;
  updateThemeModeUI();
  applyPopupBackground();
  updateBackgroundUI();
  await loadAudioTracks();
  applyAudioVolume();
  updateAudioUI();
  await restoreAudioPlaybackState();
}

async function refreshActiveTabState(showMessage = false) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.activeTab = tab || null;
  state.isOnFacebook = Boolean(tab?.url?.startsWith(FACEBOOK_ORIGIN));
  state.isOnStory = Boolean(tab?.url?.includes(STORY_PATH_TOKEN));

  await refreshPageTheme();
  updateThemeModeUI();
  applyEffectiveTheme();
  renderPageState();
  updateControls();

  if (showMessage) {
    if (state.isOnStory) {
      setMessage("Tab story đã sẵn sàng. Chọn emoji để gửi reaction.", "success");
    } else if (state.isOnFacebook) {
      setMessage("Bạn đang ở Facebook nhưng chưa mở story.", "warning");
    } else {
      setMessage("Popup chỉ hoạt động khi tab hiện tại là Facebook Story.", "warning");
    }
  }
}

async function refreshPageTheme() {
  if (!state.isOnFacebook) {
    state.pageTheme = "light";
  } else {
    const context = await sendCommand("GET_PAGE_CONTEXT");
    state.pageTheme = context?.theme === "dark" ? "dark" : "light";
  }

  state.effectiveTheme = state.themePreference === "auto" ? state.pageTheme : state.themePreference;
}

function applyEffectiveTheme() {
  document.body.dataset.pageTheme = state.effectiveTheme;
}

function applyPopupBackground() {
  if (!state.popupBackground) {
    document.body.classList.remove("has-custom-bg");
    document.body.style.removeProperty("--popup-bg-image");
    return;
  }

  document.body.classList.add("has-custom-bg");
  document.body.style.setProperty("--popup-bg-image", `url("${state.popupBackground}")`);
}

function updateThemeModeUI() {
  const mapping = {
    auto: {
      button: "Giao diện: Tự động",
      help: "Đang tự động đồng bộ theo giao diện web."
    },
    dark: {
      button: "Giao diện: Dark",
      help: "Đang khóa popup ở dark mode."
    },
    light: {
      button: "Giao diện: Light",
      help: "Đang khóa popup ở light mode."
    }
  };

  const current = mapping[state.themePreference] || mapping.auto;
  elements.themeModeToggle.textContent = current.button;
  elements.themeModeHelp.textContent = state.themePreference === "auto"
    ? `Đang tự động đồng bộ theo giao diện web (${state.pageTheme}).`
    : current.help;
}

function updateBackgroundUI() {
  const hasBackground = Boolean(state.popupBackground);
  elements.backgroundHelp.textContent = hasBackground
    ? "Ảnh nền đã được cắt theo khung popup và sẽ giữ lại sau khi reload."
    : "Chưa có ảnh nền tùy chỉnh.";
  elements.resetBackground.disabled = !hasBackground;
}

async function loadAudioTracks() {
  state.audioTracks = await getAllAudioTracks();
  await hydrateMissingArtwork();
  const restoreTrackId = state.audioRestoreState?.trackId || "";
  const restoredIndex = restoreTrackId
    ? state.audioTracks.findIndex((track) => track.id === restoreTrackId)
    : -1;
  state.currentTrackIndex = restoredIndex >= 0 ? restoredIndex : (state.audioTracks.length > 0 ? 0 : -1);
  state.isAudioPlaying = false;
  state.audioDuration = 0;
  state.audioPosition = 0;
  releaseCurrentTrackUrl();
}

async function hydrateMissingArtwork(forceRefresh = false) {
  let changed = false;
  let refreshedCount = 0;

  for (const track of state.audioTracks) {
    if ((!forceRefresh && track.artwork) || !track.data) {
      continue;
    }

    const artwork = await extractAudioArtworkFromDataUrl(track.data);
    if (!artwork && !forceRefresh) {
      continue;
    }

    track.artwork = artwork || "";
    await saveAudioTrack(track);
    changed = true;
    if (artwork) {
      refreshedCount += 1;
    }
  }

  if (changed) {
    state.audioTracks = await getAllAudioTracks();
  }

  return refreshedCount;
}

function normalizeThemePreference(value) {
  return value === "dark" || value === "light" ? value : "auto";
}

function getNextThemePreference(current) {
  if (current === "auto") {
    return "dark";
  }

  if (current === "dark") {
    return "light";
  }

  return "auto";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không thể đọc file ảnh."));
    reader.readAsDataURL(file);
  });
}

async function addAudioFiles(files) {
  const validFiles = files.filter((file) => file.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm)$/i.test(file.name));
  if (validFiles.length === 0) {
    setMessage("Không tìm thấy file nhạc hợp lệ để thêm.", "warning");
    return;
  }

  const existing = await getAllAudioTracks();
  const nextOrderBase = existing.length;

  const tracksToSave = await Promise.all(
    validFiles.map(async (file, index) => ({
      id: crypto.randomUUID(),
      name: file.name,
      type: file.type || "audio/*",
      data: await readFileAsDataUrl(file),
      artwork: await extractAudioArtwork(file),
      order: nextOrderBase + index
    }))
  );

  for (const track of tracksToSave) {
    await saveAudioTrack(track);
  }

  await loadAudioTracks();
  await restoreAudioPlaybackState();
  updateAudioUI();
  setMessage(`Đã thêm ${tracksToSave.length} bài hát vào playlist.`, "success");
}

async function clearAudioPlaylist() {
  releaseCurrentTrackUrl();
  elements.audioPlayer.pause();
  elements.audioPlayer.removeAttribute("src");
  elements.audioPlayer.load();

  await clearAllAudioTracks();
  state.audioTracks = [];
  state.currentTrackIndex = -1;
  state.isAudioPlaying = false;
  state.audioPosition = 0;
  state.audioDuration = 0;
  state.audioRestoreState = null;
  await chrome.storage.local.remove(AUDIO_STATE_KEY);
  updateAudioUI();
  setMessage("Đã xóa toàn bộ playlist nhạc.", "success");
}

async function selectTrack(index, autoplay = false) {
  const track = state.audioTracks[index];
  if (!track) {
    return;
  }

  releaseCurrentTrackUrl();
  state.currentTrackIndex = index;
  state.currentTrackUrl = track.data;
  state.audioPosition = 0;
  state.audioDuration = 0;
  state.audioRestoreState = autoplay ? null : state.audioRestoreState;
  elements.audioPlayer.src = state.currentTrackUrl;
  elements.audioPlayer.load();
  updateAudioUI();
  await persistAudioPlaybackState();

  if (autoplay) {
    await elements.audioPlayer.play();
  }
}

function updateAudioUI() {
  const hasTracks = state.audioTracks.length > 0;

  elements.audioCount.textContent = `${state.audioTracks.length} bài`;
  elements.audioCurrent.textContent = state.audioTracks[state.currentTrackIndex]?.name || "Chưa có bài hát nào.";
  elements.audioPlay.textContent = state.isAudioPlaying ? "Tạm dừng" : "Phát";
  elements.audioPrev.disabled = !hasTracks;
  elements.audioNext.disabled = !hasTracks;
  elements.audioPlay.disabled = !hasTracks;
  elements.clearAudio.disabled = !hasTracks;
  elements.audioHelp.textContent = hasTracks
    ? "Playlist và lịch sử phát được lưu cục bộ sau khi reload popup."
    : "Thêm nhiều bài hát và phát các định dạng mà trình duyệt hỗ trợ.";

  updateAudioProgressUI();
  updateAudioVolumeUI();
  renderAudioList();
}

function updateAudioProgressUI() {
  const duration = Number.isFinite(elements.audioPlayer.duration) ? elements.audioPlayer.duration : state.audioDuration;
  const currentTime = Number.isFinite(elements.audioPlayer.currentTime) ? elements.audioPlayer.currentTime : state.audioPosition;
  const progress = duration > 0 ? Math.min((currentTime / duration) * 100, 100) : 0;

  elements.audioProgress.value = String(progress || 0);
  elements.audioCurrentTime.textContent = formatTime(currentTime);
  elements.audioDuration.textContent = formatTime(duration);
  elements.audioProgress.disabled = duration <= 0;
}

function updateAudioVolumeUI() {
  const volumePercent = Math.round(state.audioVolume * 100);
  elements.audioVolume.value = String(volumePercent);
  elements.audioVolumeValue.textContent = `${volumePercent}%`;
}

function applyAudioVolume() {
  elements.audioPlayer.volume = state.audioVolume;
}

function renderAudioList() {
  elements.audioList.innerHTML = "";

  if (state.audioTracks.length === 0) {
    elements.audioList.innerHTML = '<div class="empty-state">Playlist đang trống.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.audioTracks.forEach((track, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `track-btn${index === state.currentTrackIndex ? " active" : ""}`;
    button.textContent = track.name;
    button.addEventListener("click", async () => {
      await selectTrack(index, true);
    });
    fragment.appendChild(button);
  });

  elements.audioList.appendChild(fragment);
}

function releaseCurrentTrackUrl() {
  if (!state.currentTrackUrl) {
    return;
  }

  if (state.currentTrackUrl.startsWith("blob:")) {
    URL.revokeObjectURL(state.currentTrackUrl);
  }

  state.currentTrackUrl = "";
}

async function restoreAudioPlaybackState() {
  if (state.currentTrackIndex < 0) {
    updateAudioUI();
    return;
  }

  const track = state.audioTracks[state.currentTrackIndex];
  if (!track) {
    updateAudioUI();
    return;
  }

  releaseCurrentTrackUrl();
  state.currentTrackUrl = track.data;
  elements.audioPlayer.src = state.currentTrackUrl;
  elements.audioPlayer.load();
  applyAudioVolume();
  updateAudioUI();
}

function normalizeAudioPlaybackState(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return {
    trackId: typeof value.trackId === "string" ? value.trackId : "",
    position: Number.isFinite(value.position) ? Math.max(0, value.position) : 0,
    volume: Number.isFinite(value.volume) ? Math.min(Math.max(value.volume, 0), 1) : 1,
    wasPlaying: Boolean(value.wasPlaying)
  };
}

async function persistAudioPlaybackState() {
  const track = state.audioTracks[state.currentTrackIndex];
  const payload = track
    ? {
        trackId: track.id,
        position: Number.isFinite(elements.audioPlayer.currentTime) ? elements.audioPlayer.currentTime : state.audioPosition,
        volume: state.audioVolume,
        wasPlaying: state.isAudioPlaying
      }
    : null;

  await chrome.storage.local.set({ [AUDIO_STATE_KEY]: payload });
}

function formatTime(value) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function openAudioDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(AUDIO_DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE_NAME)) {
        db.createObjectStore(AUDIO_STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Không thể mở audio database."));
  });
}

async function getAllAudioTracks() {
  const db = await openAudioDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, "readonly");
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => {
      const tracks = Array.isArray(request.result) ? request.result : [];
      tracks.sort((a, b) => (a.order || 0) - (b.order || 0));
      resolve(tracks);
      db.close();
    };

    request.onerror = () => {
      reject(request.error || new Error("Không thể đọc playlist."));
      db.close();
    };
  });
}

async function saveAudioTrack(track) {
  const db = await openAudioDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, "readwrite");
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    const request = store.put(track);

    request.onsuccess = () => {
      resolve();
      db.close();
    };

    request.onerror = () => {
      reject(request.error || new Error("Không thể lưu file nhạc."));
      db.close();
    };
  });
}

async function clearAllAudioTracks() {
  const db = await openAudioDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(AUDIO_STORE_NAME, "readwrite");
    const store = transaction.objectStore(AUDIO_STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      resolve();
      db.close();
    };

    request.onerror = () => {
      reject(request.error || new Error("Không thể xóa playlist."));
      db.close();
    };
  });
}

async function createPopupBackgroundImage(file) {
  const source = await readFileAsDataUrl(file);
  const image = await loadImage(source);

  const fallbackWidth = 384;
  const fallbackHeight = 620;
  const targetWidth = Math.max(window.innerWidth || fallbackWidth, fallbackWidth);
  const targetHeight = Math.max(window.innerHeight || fallbackHeight, fallbackHeight);

  const outputWidth = Math.min(targetWidth * 2, 900);
  const outputHeight = Math.min(targetHeight * 2, 1400);

  const sourceRatio = image.width / image.height;
  const targetRatio = outputWidth / outputHeight;

  let cropWidth = image.width;
  let cropHeight = image.height;
  let cropX = 0;
  let cropY = 0;

  if (sourceRatio > targetRatio) {
    cropWidth = image.height * targetRatio;
    cropX = (image.width - cropWidth) / 2;
  } else {
    cropHeight = image.width / targetRatio;
    cropY = (image.height - cropHeight) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const context = canvas.getContext("2d");
  if (!context) {
    return source;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputWidth,
    outputHeight
  );

  return canvas.toDataURL("image/jpeg", 0.92);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Không thể tải ảnh nền."));
    image.src = src;
  });
}

async function extractAudioArtwork(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  if (isId3v2(bytes)) {
    const artwork = extractId3Artwork(bytes);
    if (artwork) {
      return artwork;
    }
  }

  return "";
}

async function extractAudioArtworkFromDataUrl(dataUrl) {
  try {
    const bytes = dataUrlToBytes(dataUrl);
    if (!isId3v2(bytes)) {
      return "";
    }

    return extractId3Artwork(bytes);
  } catch (error) {
    return "";
  }
}

function isId3v2(bytes) {
  return bytes.length > 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33;
}

function extractId3Artwork(bytes) {
  const version = bytes[3];
  const tagSize = readSynchsafeInteger(bytes, 6);
  let offset = 10;
  const end = Math.min(bytes.length, 10 + tagSize);

  while (offset + 10 <= end) {
    const frameId = readAscii(bytes, offset, 4);
    if (!frameId.trim()) {
      break;
    }

    const frameSize = version === 4
      ? readSynchsafeInteger(bytes, offset + 4)
      : readUInt32(bytes, offset + 4);

    if (frameSize <= 0 || offset + 10 + frameSize > end) {
      break;
    }

    if (frameId === "APIC") {
      return parseApicFrame(bytes.slice(offset + 10, offset + 10 + frameSize));
    }

    offset += 10 + frameSize;
  }

  return "";
}

function parseApicFrame(frame) {
  if (!frame.length) {
    return "";
  }

  const encoding = frame[0];
  let cursor = 1;
  const mimeEnd = frame.indexOf(0x00, cursor);
  if (mimeEnd === -1) {
    return "";
  }

  const mime = readAscii(frame, cursor, mimeEnd - cursor) || "image/jpeg";
  cursor = mimeEnd + 1;
  cursor += 1;

  const descriptionEnd = findTextTerminator(frame, cursor, encoding);
  if (descriptionEnd === -1) {
    return "";
  }

  cursor = descriptionEnd + (encoding === 1 || encoding === 2 ? 2 : 1);
  const imageBytes = frame.slice(cursor);
  if (!imageBytes.length) {
    return "";
  }

  return `data:${mime};base64,${bytesToBase64(imageBytes)}`;
}

function findTextTerminator(bytes, start, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = start; i < bytes.length - 1; i += 1) {
      if (bytes[i] === 0x00 && bytes[i + 1] === 0x00) {
        return i;
      }
    }
    return bytes.length;
  }

  const end = bytes.indexOf(0x00, start);
  return end === -1 ? bytes.length : end;
}

function readAscii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function readSynchsafeInteger(bytes, start) {
  return (
    ((bytes[start] & 0x7f) << 21) |
    ((bytes[start + 1] & 0x7f) << 14) |
    ((bytes[start + 2] & 0x7f) << 7) |
    (bytes[start + 3] & 0x7f)
  );
}

function readUInt32(bytes, start) {
  return (
    (bytes[start] << 24) |
    (bytes[start + 1] << 16) |
    (bytes[start + 2] << 8) |
    bytes[start + 3]
  ) >>> 0;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
  }

  return btoa(binary);
}

function dataUrlToBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) {
    throw new Error("Invalid data URL");
  }

  const base64 = dataUrl.slice(commaIndex + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function renderPageState() {
  if (!state.activeTab?.url) {
    elements.pageStatus.textContent = "Không tìm thấy tab";
    elements.pageStatus.className = "status-pill error";
    elements.pageMeta.textContent = "Không có URL hoạt động";
    return;
  }

  if (state.isOnStory) {
    elements.pageStatus.textContent = "Sẵn sàng gửi reaction";
    elements.pageStatus.className = "status-pill ready";
    elements.pageMeta.textContent = "Facebook Story";
    return;
  }

  if (state.isOnFacebook) {
    elements.pageStatus.textContent = "Đang ở Facebook";
    elements.pageStatus.className = "status-pill warning";
    elements.pageMeta.textContent = "Hãy mở một story";
    return;
  }

  elements.pageStatus.textContent = "Sai ngữ cảnh";
  elements.pageStatus.className = "status-pill error";
  elements.pageMeta.textContent = shortenUrl(state.activeTab.url);
}

function updateControls() {
  const disabled = !state.isOnStory || state.isPopupBusy;
  elements.search.disabled = state.allEmojis.length === 0;
  elements.refreshStatus.disabled = state.isPopupBusy;
  elements.openStory.disabled = state.isPopupBusy;

  document.querySelectorAll(".emoji-btn, .recent-btn").forEach((button) => {
    button.disabled = disabled;
  });
}

function filterEmojis(query) {
  const normalized = query.trim();
  if (!normalized) {
    state.filteredEmojis = [...state.allEmojis];
    return;
  }

  state.filteredEmojis = state.allEmojis.filter((emoji) => {
    const rawValue = String(emoji?.value || "");
    const rawUrl = String(emoji?.url || "");
    return rawValue.includes(normalized) || rawUrl.toLowerCase().includes(normalized.toLowerCase());
  });
}

function renderEmojiGrid() {
  elements.grid.innerHTML = "";

  if (state.filteredEmojis.length === 0) {
    elements.grid.innerHTML = '<div class="empty-state">Không có emoji phù hợp với từ khóa hiện tại.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  state.filteredEmojis.forEach((emoji) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "emoji-btn";
    button.textContent = emoji.value;
    button.title = emoji.url || emoji.value;
    button.disabled = !state.isOnStory || state.isPopupBusy;
    button.addEventListener("click", () => triggerReaction(emoji.value));
    fragment.appendChild(button);
  });

  elements.grid.appendChild(fragment);
}

function renderRecentEmojis() {
  elements.recentList.innerHTML = "";

  if (state.recentEmojis.length === 0) {
    elements.recentList.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;">Các emoji bạn dùng gần đây sẽ hiện ở đây.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  state.recentEmojis.forEach((value) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "recent-btn";
    button.textContent = value;
    button.title = `Gửi lại ${value}`;
    button.disabled = !state.isOnStory || state.isPopupBusy;
    button.addEventListener("click", () => triggerReaction(value));
    fragment.appendChild(button);
  });

  elements.recentList.appendChild(fragment);
}

async function triggerReaction(emoji) {
  if (!state.isOnStory || !state.activeTab?.id) {
    setMessage("Mở một Facebook Story trước khi gửi reaction.", "warning");
    return;
  }

  state.isPopupBusy = true;
  updateControls();
  setMessage(`Đang gửi ${emoji}...`);

  const response = await sendCommand("TRIGGER_REACTION", emoji);

  state.isPopupBusy = false;
  updateControls();

  if (response?.status === "success") {
    saveRecentEmoji(emoji);
    setMessage(`Đã gửi reaction ${emoji} tới story hiện tại.`, "success");
    return;
  }

  const errorText = response?.message || "Tab hiện tại chưa sẵn sàng hoặc Facebook từ chối yêu cầu.";
  setMessage(errorText, "error");
}

function saveRecentEmoji(value) {
  state.recentEmojis = [value, ...state.recentEmojis.filter((item) => item !== value)].slice(0, RECENT_EMOJIS_LIMIT);
  chrome.storage.local.set({ recentEmojis: state.recentEmojis });
  renderRecentEmojis();
  updateControls();
}

function sendCommand(action, payload) {
  return new Promise((resolve) => {
    if (!state.activeTab?.id) {
      resolve({ status: "error", message: "Không tìm thấy tab đang hoạt động." });
      return;
    }

    chrome.tabs.sendMessage(state.activeTab.id, { action, payload }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({
          status: "error",
          message: "Không thể kết nối với tab này. Hãy mở Facebook Story và tải lại trang."
        });
        return;
      }

      resolve(response || { status: "error", message: "Tab không trả về phản hồi hợp lệ." });
    });
  });
}

function setMessage(text, tone = "") {
  elements.message.textContent = text;
  elements.message.className = tone ? `message ${tone}` : "message";
}

function shortenUrl(url) {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname}${pathname}`.slice(0, 36);
  } catch (error) {
    return url.slice(0, 36);
  }
}
