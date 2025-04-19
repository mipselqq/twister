export async function translateBackAndForth(translationPipeline, pipelineLength, fromLang, plugin, html, progressCallback) {
    const parser = new DOMParser();
    const dom = parser.parseFromString(html, 'text/html');
    const document = dom;

    progressCallback({ status: `Loaded plugin: ${plugin.name}` });

    const textNodes = [];
    collectTextNodes(textNodes, document.body);

    if (textNodes.length === 0) {
        progressCallback({ status: `No text nodes found to translate.` });
        return dom.documentElement.outerHTML;
    }

    let prevLang = fromLang;
    const actualPipelineArrayLength = translationPipeline.length;
    let finalPipelineLength = pipelineLength;
    const totalLangsForProgress = pipelineLength + (prevLang !== fromLang ? 1 : 0);

    progressCallback({ type: 'language', current: 0, total: totalLangsForProgress, status: `Starting... 0/${pipelineLength}` });
    progressCallback({ type: 'chunk', current: 0, total: 0 });

    for (let i = 0; i < finalPipelineLength; i++) {
        const langIndex = i % actualPipelineArrayLength;
        const lang = translationPipeline[langIndex];

        const langNo = i + 1;
        progressCallback({ status: `${langNo}. ${prevLang} -> ${lang}` });

        try {
            await translateNodes(plugin, textNodes, prevLang, lang, progressCallback);
            prevLang = lang;
            progressCallback({ type: 'language', current: langNo, total: totalLangsForProgress });
        } catch (error) {
            console.error("Translation step failed:", error);
            progressCallback({ status: `Failed ${prevLang}->${lang}, skipping step ${langNo}. Err: ${error.message?.substring(0, 50)}...` });
            progressCallback({ type: 'language', current: langNo, total: totalLangsForProgress });
        }
        progressCallback({ type: 'chunk', current: 0, total: 0 });
    }

    if (prevLang !== fromLang) {
        const finalStepNo = finalPipelineLength + 1;

        progressCallback({ status: `${finalStepNo}. ${prevLang} -> ${fromLang}` });
        try {
            await translateNodes(plugin, textNodes, prevLang, fromLang, progressCallback);
            progressCallback({ type: 'language', current: finalStepNo, total: totalLangsForProgress });
        } catch (error) {
            console.error("Failed to translate back to source language:", error);
            progressCallback({ status: `FAIL ${prevLang}->${fromLang}. Err: ${error.message?.substring(0, 50)}...` });
            progressCallback({ type: 'language', current: finalStepNo, total: totalLangsForProgress });
        }
        progressCallback({ type: 'chunk', current: 0, total: 0 });
    } else {
        progressCallback({ type: 'language', current: totalLangsForProgress, total: totalLangsForProgress });
    }

    progressCallback({ status: `Done` });

    return dom.documentElement.outerHTML;
}

async function translateNodes(plugin, textNodes, fromLang, toLang, progressCallback) {
    const batches = [];
    let currentBatch = [];
    let currentLength = 0;

    const validTextNodes = textNodes.filter(node => node.textContent && node.textContent.trim().length > 0);

    if (validTextNodes.length === 0) {
        progressCallback({ status: `No text content in this step (${fromLang} -> ${toLang})` });
        return;
    }

    for (const node of validTextNodes) {
        const text = node.textContent;
        const textLength = text.length + (currentBatch.length > 0 ? plugin.separator.length : 0);

        if (currentLength + textLength > plugin.maxTextLength && currentBatch.length > 0) {
            batches.push(currentBatch);
            currentBatch = [text];
            currentLength = text.length;
        } else {
            currentBatch.push(text);
            currentLength += textLength;
        }
    }

    if (currentBatch.length > 0) {
        batches.push(currentBatch);
    }

    if (batches.length === 0) {
        progressCallback({ status: `No batches created for ${fromLang} -> ${toLang}` });
        return;
    }

    const totalChunks = batches.reduce((sum, batch) => sum + batch.length, 0);
    let translatedChunksCount = 0;

    progressCallback({ type: 'chunk', current: 0, total: totalChunks });

    const translatedTexts = await translateBatched(batches, plugin, fromLang, toLang, (processedInBatch) => {
        translatedChunksCount += processedInBatch;
        progressCallback({ type: 'chunk', current: translatedChunksCount, total: totalChunks });
    }, progressCallback);

    let translatedTextIndex = 0;
    for (let i = 0; i < validTextNodes.length; i++) {
        if (translatedTextIndex < translatedTexts.length) {
            if (validTextNodes[i].textContent !== translatedTexts[translatedTextIndex]) {
                validTextNodes[i].textContent = translatedTexts[translatedTextIndex];
            }
            translatedTextIndex++;
        } else {
            console.warn(`Warning: Missing translated text for node index ${i}`);
            progressCallback({ status: `WARN: Missing translation for node ${i}` });
        }
    }

    progressCallback({ type: 'chunk', current: totalChunks, total: totalChunks });
}

async function translateBatched(batches, plugin, fromLang, toLang, chunkProgressCallback, statusCallback) {
    const translatedTexts = [];
    const maxWorkers = plugin.maxParallelWorkers || 1;

    const processBatch = async (batch) => {
        const batchText = batch.join(plugin.separator);
        try {
            const translatedBatch = await plugin.strategy(batchText, fromLang, toLang);
            if (plugin.sleepAfterMs > 0) {
                await sleep(plugin.sleepAfterMs);
            }
            const translatedParts = translatedBatch.split(plugin.separator);

            if (translatedParts.length < batch.length) {
                statusCallback({ status: `WARN: got ${translatedParts.length} parts of ${batch.length}` });
                while (translatedParts.length < batch.length) {
                    translatedParts.push(batch[translatedParts.length]);
                }
            }
            const resultParts = translatedParts.slice(0, batch.length);
            chunkProgressCallback(resultParts.length);
            return resultParts;

        } catch (error) {
            console.error(`Batch translation failed (${fromLang} -> ${toLang}):`, error);
            statusCallback({ status: `WARN: Batch failed ${fromLang}->${toLang}. Using originals.` });
            chunkProgressCallback(batch.length);
            return batch;
        }
    };

    const workersCount = isFinite(maxWorkers) ? maxWorkers : batches.length;
    for (let i = 0; i < batches.length; i += workersCount) {
        const currentBatches = batches.slice(i, i + workersCount);
        const effectiveWorkers = currentBatches.length;

        statusCallback({ status: `Translating ${fromLang}->${toLang} (Batch group starting ${i + 1}/${batches.length}, Workers: ${effectiveWorkers})` });

        const promises = currentBatches.map(batch => processBatch(batch));
        const results = await Promise.all(promises);

        for (const result of results) {
            translatedTexts.push(...result);
        }
    }


    return translatedTexts;
}

function collectTextNodes(textNodes, node) {
    if (node.nodeType === Node.ELEMENT_NODE && ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(node.nodeName)) {
        return;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
        return;
    }

    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text && text.trim().length > 0) {
            textNodes.push(node);
        }
    } else {
        for (const child of node.childNodes) {
            collectTextNodes(textNodes, child);
        }
    }
}

const sleep = async (ms) => new Promise(resolve => setTimeout(resolve, ms));
