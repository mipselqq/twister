let isTranslating = false;

async function main(message) {
    if (typeof window.twistedWebTranslate === 'function') {
        console.log("Twister modules already loaded.");
    } else {
        try {
            const translateModule = await import(chrome.runtime.getURL('translate.js'));
            const pipelineModule = await import(chrome.runtime.getURL('pipeline.js'));
            const googlePluginModule = await import(chrome.runtime.getURL('plugins/google.js'));
            const yandexPluginModule = await import(chrome.runtime.getURL('plugins/yandex-browser.js'));

            window.twistedWebTranslate = translateModule.translateBackAndForth;
            window.TRANSLATION_PIPELINE = pipelineModule.TRANSLATION_PIPELINE;
            window.PLUGINS = {
                google: googlePluginModule.PLUGIN,
                yandex: yandexPluginModule.PLUGIN
            };
            console.log("Twister modules loaded successfully.");
        } catch (error) {
            console.error("Failed to load Twister modules:", error);
            chrome.runtime.sendMessage({ action: 'translationError', error: `Failed to load modules: ${error.message}` });
            isTranslating = false;
            return;
        }
    }

    if (isTranslating) {
        console.warn("Translation already in progress.");
        return;
    }
    isTranslating = true;

    const { settings } = message;
    const { fromLang, pipelineLength, pluginName } = settings;

    console.log(`Starting translation: ${fromLang}, ${pipelineLength} steps, using ${pluginName}`);

    const plugin = window.PLUGINS[pluginName];
    if (!plugin) {
        console.error(`Selected plugin "${pluginName}" not found.`);
        chrome.runtime.sendMessage({ action: 'translationError', error: `Plugin "${pluginName}" not found.` });
        isTranslating = false;
        return;
    }

    const html = document.documentElement.outerHTML;

    const progressCallback = (progressData) => {
        chrome.runtime.sendMessage({ action: 'updateProgress', data: progressData });
    };

    try {
        const translatedHtml = await window.twistedWebTranslate(
            window.TRANSLATION_PIPELINE,
            pipelineLength,
            fromLang,
            plugin,
            html,
            progressCallback
        );

        document.open();
        document.write(translatedHtml);
        document.close();

        console.log("Translation complete, page updated.");
        chrome.runtime.sendMessage({ action: 'translationComplete' });

    } catch (error) {
        console.error("Translation failed:", error);
        chrome.runtime.sendMessage({ action: 'translationError', error: error.message || 'Unknown error during translation.' });
    } finally {
        isTranslating = false;
    }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'startTranslation') {
        console.log("Received startTranslation message:", message.settings);
        main(message).then(() => {
            sendResponse({ status: "started" });
        }).catch(error => {
            console.error("Error in main execution:", error);
            sendResponse({ status: "error", message: error.message });
            isTranslating = false;
        });
        return true;
    }
});

console.log("Twister content script loaded and listening.");
if (typeof window.twistedWebTranslate !== 'function') {
    console.log("Attempting to load modules immediately (might happen on re-injection)...");
}
