const elements = {
    fromLangInput: document.getElementById('fromLang'),
    pipelineLengthInput: document.getElementById('pipelineLength'),
    pluginSelect: document.getElementById('pluginSelect'),
    startButton: document.getElementById('startButton'),
    langProgress: document.getElementById('langProgress'),
    chunkProgress: document.getElementById('chunkProgress'),
    langStatus: document.getElementById('langStatus'),
    chunkStatus: document.getElementById('chunkStatus'),
    statusMessage: document.getElementById('statusMessage'),
    pipelineLengthInfo: document.getElementById('pipelineLengthInfo'),
};

function getSettings() {
    return {
        fromLang: elements.fromLangInput.value.trim() || 'en',
        pipelineLength: parseInt(elements.pipelineLengthInput.value, 10) || 10,
        pluginName: elements.pluginSelect.value
    };
}

function updateProgress(type, current, total) {
    const percent = total > 0 ? (current / total) * 100 : 0;
    if (type === 'language') {
        elements.langProgress.style.width = `${percent}%`;
        elements.langStatus.textContent = `Language: ${current}/${total}`;
    } else if (type === 'chunk') {
        elements.chunkProgress.style.width = `${percent}%`;
        elements.chunkStatus.textContent = `Chunks: ${current}/${total}`;
    }
}

function setStatus(message) {
    elements.statusMessage.textContent = message;
    console.log("Status:", message);
}

function resetUI() {
    updateProgress('language', 0, 0);
    updateProgress('chunk', 0, 0);
    elements.langStatus.textContent = 'Language Progress:';
    elements.chunkStatus.textContent = 'Chunk Progress:';
    setStatus('');
    setButtonState(true);
}

function setButtonState(enabled) {
    elements.startButton.disabled = !enabled;
}

function setPipelineInfo(text) {
    elements.pipelineLengthInfo.textContent = text;
}

function initUI(startButtonListener) {
    elements.startButton.addEventListener('click', startButtonListener);
}

let isTranslating = false;

async function loadPipelineInfo() {
    try {
        const pipelineModule = await import(chrome.runtime.getURL('pipeline.js'));
        const pipelineLength = pipelineModule.TRANSLATION_PIPELINE.length;
        setPipelineInfo(`(Max ${pipelineLength})`);
    } catch (error) {
        console.error("Failed to load pipeline info:", error);
        setPipelineInfo("(Error loading length)");
    }
}

function handleError(errorMessage) {
    console.error("Translation Error:", errorMessage);
    if (document.body) {
        setStatus(`Error: ${errorMessage}`);
        setButtonState(true);
    }
    isTranslating = false;
}

async function startTranslation() {
    if (isTranslating) return;

    isTranslating = true;
    resetUI();
    setButtonState(false);
    setStatus('Starting translation...');

    const settings = getSettings();

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || !tab.id) {
            throw new Error("No active tab with ID found.");
        }

        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['worker.js'],
            });

            await new Promise(resolve => setTimeout(resolve, 150));
        } catch (injectionError) {
            if (!injectionError.message.includes('Cannot create item with duplicate id') &&
                !injectionError.message.includes('already injected')) {
                console.warn("Content script injection failed (might be okay if already injected):", injectionError.message);
            }
        }

        chrome.tabs.sendMessage(tab.id, { action: 'startTranslation', settings }, (response) => {
            if (chrome.runtime.lastError) {
                handleError(`Error sending message: ${chrome.runtime.lastError.message}`);
            } else if (response?.status === 'error') {
                handleError(response.message || "Content script reported an error.");
            } else if (response?.status === 'started') {
                setStatus('Translation in progress...');
            } else {
                handleError('No response or unexpected response from content script.');
            }
        });

    } catch (error) {
        handleError(error.message || "Unknown error during setup.");
    }
}

function handleMessage(message, sender, sendResponse) {
    if (!document.body) {
        console.log("Popup closed, ignoring message:", message.action);
        isTranslating = false;
        return false;
    }

    switch (message.action) {
        case 'updateProgress':
            const { type, current, total, status } = message.data;
            if (type) {
                updateProgress(type, current, total);
            }
            if (status) {
                setStatus(status);
            }
            return true;
        case 'translationComplete':
            setStatus('Translation complete!');
            setButtonState(true);
            isTranslating = false;
            return false;
        case 'translationError':
            handleError(message.error || "Content script reported an unspecified translation error.");
            return false;
        default:
            return false;
    }
}

function initTranslationManager() {
    loadPipelineInfo();
    chrome.runtime.onMessage.addListener(handleMessage);
}

initUI(startTranslation);
initTranslationManager();
resetUI();
