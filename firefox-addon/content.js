// Detect browser type
function getBrowserType() {
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    return 'chrome';
  }
  return 'firefox';
}

const BROWSER = getBrowserType();
console.log("🎆 Fireworks: Browser detected as:", BROWSER);
console.log("🎆 Fireworks: content.js loaded successfully!");

// Helper functions for formatting
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(seconds) {
  if (!seconds || seconds < 1) return '< 1s';
  if (seconds < 60) return Math.round(seconds) + 's';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return mins + 'm ' + secs + 's';
}

// Listen for messages from the popup and background script
const browserAPI = BROWSER === 'chrome' ? chrome : browser;

browserAPI.runtime.onMessage.addListener((req, sender, sendResponse) => {
  if (req.action === "getPageInfo") {
    const info = gatherPageInfo();
    sendResponse(info);
  } else if (req.type === 'DOWNLOAD_STATUS') {
    // Status messages disabled to reduce console noise
  } else if (req.type === 'DOWNLOAD_PROGRESS') {
    // Handle download progress updates
    const container = document.getElementById('fireworks-viewer-container');
    if (!container) {
      return;
    }
    
    const progressBar = container.querySelector('.fireworks-progress-bar');
    const loadingText = container.querySelector('.fireworks-loading-text');
    
    if (progressBar && req.progress !== undefined) {
      progressBar.style.width = req.progress + '%';
    }
    
    if (loadingText && req.progress !== undefined) {
      const loadedStr = formatBytes(req.loaded || 0);
      const totalStr = formatBytes(req.total || 0);
      const speedStr = formatBytes(req.speed || 0) + '/s';
      const timeStr = formatTime(req.timeRemaining || 0);
      const newText = `Loading notebook... ${Math.round(req.progress)}% (${loadedStr} / ${totalStr}) - ${speedStr} - ${timeStr} remaining`;
      loadingText.textContent = newText;
    }
  }
});

function gatherPageInfo() {
  const pageText = document.body.innerText;
  const hasLargeFileMsg = pageText.includes("Large file hidden");
  
  const downloadButtons = document.querySelectorAll('a[href*=".ipynb"], button:contains("Download")');
  const downloadLink = Array.from(downloadButtons).find(btn => {
    if (!btn.href) return false;
    const hrefLower = btn.href.toLowerCase();
    return hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
  });
  
  return {
    hasLargeFile: hasLargeFileMsg,
    downloadUrl: downloadLink?.href || null,
    fileName: extractFileName(downloadLink?.href || '')
  };
}

function extractFileName(url) {
  // Remove query parameters first
  const urlWithoutQuery = url.split('?')[0];
  const parts = urlWithoutQuery.split('/');
  const fileName = parts[parts.length - 1] || 'notebook.ipynb';
  // Don't force .ipynb extension - preserve actual file extension
  // This helps detect PDFs and other file types
  return fileName;
}

function isNotebookFile(url) {
  const urlLower = url.toLowerCase();
  // Check if URL actually points to a notebook file
  // Exclude PDFs and other non-notebook files
  if (urlLower.includes('.pdf') || urlLower.endsWith('/pdf')) {
    return false;
  }
  // Must contain .ipynb and not be a PDF
  return urlLower.includes('.ipynb') && !urlLower.includes('.pdf');
}

// Inject viewer when needed
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  
  if (event.data.type === 'FIREWORKS_SHOW_VIEWER') {
    const { downloadUrl, fileName } = event.data.payload;
    injectViewer(downloadUrl, fileName);
  }
});

function injectViewer(downloadUrl, fileName) {
  console.log("🎆 Fireworks: injectViewer called with URL:", downloadUrl);
  
  const existing = document.getElementById('fireworks-viewer-container');
  const isReload = existing !== null && viewerIsOpen;
  
  if (existing && !isReload) {
    console.log("🎆 Fireworks: Removing existing viewer");
    existing.remove();
  }
  
  // Update tracking variables
  currentNotebookUrl = downloadUrl;
  viewerIsOpen = true;
  currentPageUrl = window.location.href;
  
  // If reloading, just update the content, don't recreate the container
  if (isReload) {
    console.log("🎆 Fireworks: Reloading notebook in existing viewer");
    const container = existing;
    const header = container.querySelector('.fireworks-viewer h3');
    if (header) {
      header.textContent = `📓 Fireworks Notebook Viewer - ${escapeHtml(fileName)}`;
    }
    
    // Reset content to loading state
    const content = container.querySelector('#fireworks-content-zoomable');
    if (content) {
      content.innerHTML = `
        <div class="fireworks-loading">
          <div class="fireworks-loading-text">Loading notebook...</div>
          <div class="fireworks-progress-container">
            <div class="fireworks-progress-bar"></div>
          </div>
        </div>
        <iframe id="fireworks-iframe" style="display:none;"></iframe>
      `;
    }
    
    fetchAndDisplayNotebook(downloadUrl);
    return;
  }
  
  const container = document.createElement('div');
  container.id = 'fireworks-viewer-container';
  container.innerHTML = `
    <div class="fireworks-viewer">
      <div class="fireworks-header">
        <h3>📓 Fireworks Notebook Viewer - ${escapeHtml(fileName)}</h3>
        <div class="fireworks-header-controls">
          <div class="fireworks-zoom-controls">
            <button id="fireworks-zoom-out" class="fireworks-zoom-btn" title="Zoom Out">−</button>
            <span id="fireworks-zoom-level" class="fireworks-zoom-level">100%</span>
            <button id="fireworks-zoom-in" class="fireworks-zoom-btn" title="Zoom In">+</button>
            <button id="fireworks-reset-zoom" class="fireworks-zoom-btn" title="Reset Zoom">⟲</button>
          </div>
          <div class="fireworks-width-control">
            <label for="fireworks-width-slider" style="font-size: 12px; margin-right: 8px;">Cell Width:</label>
            <input type="range" id="fireworks-width-slider" min="50" max="100" value="60" style="width: 80px; margin-right: 8px;">
            <span id="fireworks-width-value" class="fireworks-width-value">60%</span>
          </div>
          <button id="fireworks-close" class="fireworks-close">✕</button>
        </div>
      </div>
      <div class="fireworks-content-wrapper">
        <div class="fireworks-content" id="fireworks-content-zoomable">
          <div class="fireworks-loading">
            <div class="fireworks-loading-text">Loading notebook...</div>
            <div class="fireworks-progress-container">
              <div class="fireworks-progress-bar"></div>
            </div>
          </div>
          <iframe id="fireworks-iframe" style="display:none;"></iframe>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(container);
  console.log("🎆 Fireworks: Viewer container added to DOM");
  
  document.getElementById('fireworks-close').addEventListener('click', () => {
    console.log("🎆 Fireworks: Close button clicked");
    container.remove();
    viewerIsOpen = false;
    currentNotebookUrl = null;
  });
  
  // Setup zoom controls
  setupZoomControls(container);
  
  // Setup width control
  setupWidthControl(container);
  
  // Also close on background click
  container.addEventListener('click', (e) => {
    if (e.target === container) {
      console.log("🎆 Fireworks: Background clicked, closing viewer");
      container.remove();
      viewerIsOpen = false;
      currentNotebookUrl = null;
    }
  });
  
  fetchAndDisplayNotebook(downloadUrl);
}

function fetchAndDisplayNotebook(downloadUrl) {
  console.log("🎆 Fireworks: Requesting notebook fetch from background script");
  
  // Reset progress bar - find elements from container
  const container = document.getElementById('fireworks-viewer-container');
  if (!container) {
    console.error('🎆 Fireworks: Container not found!');
    return;
  }
  
  const progressBar = container.querySelector('.fireworks-progress-bar');
  const loadingText = container.querySelector('.fireworks-loading-text');
  
  
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.style.animation = 'none';
  }
  if (loadingText) {
    loadingText.textContent = 'Loading notebook... 0%';
  }
  
  // Use background script to fetch to avoid CORS issues
  const browserAPI = BROWSER === 'chrome' ? chrome : browser;

  // Get saved connections setting
  // Use storage.local for unpacked extensions (works without permanent ID)
  const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
  storageAPI.get(['fireworksConnections'], (result) => {
    if (browserAPI.runtime.lastError) {
      console.error('🎆 Fireworks: Error loading settings:', browserAPI.runtime.lastError);
      // Use default if error
      const connections = 20;
      console.log('🎆 Fireworks: Using default', connections, 'parallel connections');
      sendFetchMessage(connections);
      return;
    }
    const connections = (result && result.fireworksConnections) ? result.fireworksConnections : 20;
    console.log('🎆 Fireworks: Using', connections, 'parallel connections');
    sendFetchMessage(connections);
  });
  
  function sendFetchMessage(connections) {
    
    browserAPI.runtime.sendMessage(
      { action: 'fetchNotebook', url: downloadUrl, connections: connections },
      (response) => {
      // Complete progress bar when done - re-query in case container was recreated
      const finalContainer = document.getElementById('fireworks-viewer-container');
      if (finalContainer) {
        const finalProgressBar = finalContainer.querySelector('.fireworks-progress-bar');
        const finalLoadingText = finalContainer.querySelector('.fireworks-loading-text');
        if (finalProgressBar) {
          finalProgressBar.style.width = '100%';
        }
        if (finalLoadingText) {
          finalLoadingText.textContent = 'Loading notebook... 100%';
        }
      }
      
      if (browserAPI.runtime.lastError) {
        console.error('🎆 Fireworks: Runtime error:', browserAPI.runtime.lastError.message);
        const loading = document.querySelector('.fireworks-loading');
        if (loading) {
          loading.innerHTML = `<div class="fireworks-error">Error: ${escapeHtml(browserAPI.runtime.lastError.message)}<br><br>Try downloading the file directly instead.</div>`;
        }
        return;
      }
      
      if (response && response.success) {
        console.log("🎆 Fireworks: Notebook loaded successfully");
        displayNotebookPreview(response.notebook);
      } else {
        console.error('🎆 Fireworks: Error loading notebook:', response?.error || 'Unknown error');
        const loading = document.querySelector('.fireworks-loading');
        if (loading) {
          loading.innerHTML = `<div class="fireworks-error">Error loading notebook: ${escapeHtml(response?.error || 'Unknown error')}<br><br>Try downloading the file directly instead.</div>`;
        }
      }
    });
  }
}

function displayNotebookPreview(notebook) {
  // Cache the latest loaded notebook so exam-grading helpers can reuse it.
  if (currentNotebookUrl && notebook && typeof notebook === 'object') {
    fireworksNotebookCache = {
      url: currentNotebookUrl,
      notebook: notebook
    };
  }

  const notebookContentArea = document.querySelector('#fireworks-content-zoomable') || 
                              document.querySelector('.fireworks-content');
  const loading = notebookContentArea ? notebookContentArea.querySelector('.fireworks-loading') : 
                  document.querySelector('.fireworks-loading');
  const cells = notebook.cells || [];
  
  console.log("🎆 Fireworks: Displaying notebook with", cells.length, "cells");
  
  let previewHTML = '<div class="fireworks-cells">';
  
  cells.forEach((cell, idx) => {
    if (cell.cell_type === 'code') {
      const sourceText = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      previewHTML += `
        <div class="fireworks-cell">
          <div class="fireworks-cell-source">
            <pre><code>${escapeHtml(sourceText)}</code></pre>
          </div>
      `;
      
      
      if (cell.outputs && cell.outputs.length > 0) {
        previewHTML += '<div class="fireworks-cell-output">';
        cell.outputs.forEach((output, outIdx) => {
          console.log(`🎆 Fireworks: Processing output ${outIdx} of type:`, output.output_type, output);
          // Handle stream output (stdout/stderr)
          if (output.output_type === 'stream') {
            const streamText = Array.isArray(output.text) ? output.text.join('') : (output.text || String(output.text || ''));
            const streamName = output.name || 'stdout';
            if (streamText) {
              previewHTML += `<div class="fireworks-output-stream"><span class="fireworks-stream-label">${streamName}:</span><pre class="fireworks-output">${escapeHtml(streamText)}</pre></div>`;
            }
          }
          // Handle execute_result (execution results)
          else if (output.output_type === 'execute_result' && output.data) {
            let rendered = false;
            // Priority order: HTML > images > plain text
            if (output.data['text/html']) {
              const html = Array.isArray(output.data['text/html']) ? output.data['text/html'].join('') : output.data['text/html'];
              previewHTML += `<div class="fireworks-output-html">${html}</div>`;
              rendered = true;
            }
            if (!rendered && output.data['image/png']) {
              const imageData = output.data['image/png'];
              const imageSrc = Array.isArray(imageData) ? imageData.join('') : imageData;
              previewHTML += `<img src="data:image/png;base64,${imageSrc}" class="fireworks-output-image" alt="Output image" />`;
              rendered = true;
            }
            if (!rendered && output.data['image/jpeg']) {
              const imageData = output.data['image/jpeg'];
              const imageSrc = Array.isArray(imageData) ? imageData.join('') : imageData;
              previewHTML += `<img src="data:image/jpeg;base64,${imageSrc}" class="fireworks-output-image" alt="Output image" />`;
              rendered = true;
            }
            if (!rendered && output.data['text/plain']) {
              const text = Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : output.data['text/plain'];
              previewHTML += `<pre class="fireworks-output">${escapeHtml(String(text))}</pre>`;
              rendered = true;
            }
            // If nothing rendered, show all available data types for debugging
            if (!rendered) {
              const dataTypes = Object.keys(output.data || {});
              console.warn(`🎆 Fireworks: Unhandled execute_result data types:`, dataTypes);
              if (dataTypes.length > 0) {
                previewHTML += `<div class="fireworks-output-debug">Available data types: ${dataTypes.join(', ')}</div>`;
                // Try to render the first available type
                const firstType = dataTypes[0];
                const firstData = output.data[firstType];
                const dataStr = Array.isArray(firstData) ? firstData.join('') : String(firstData || '');
                if (dataStr) {
                  previewHTML += `<pre class="fireworks-output">${escapeHtml(dataStr.substring(0, 500))}${dataStr.length > 500 ? '...' : ''}</pre>`;
                }
              }
            }
          }
          // Handle display_data (display outputs)
          else if (output.output_type === 'display_data' && output.data) {
            let rendered = false;
            // Priority order: HTML > images > plain text
            if (output.data['text/html']) {
              const html = Array.isArray(output.data['text/html']) ? output.data['text/html'].join('') : output.data['text/html'];
              previewHTML += `<div class="fireworks-output-html">${html}</div>`;
              rendered = true;
            }
            if (!rendered && output.data['image/png']) {
              const imageData = output.data['image/png'];
              const imageSrc = Array.isArray(imageData) ? imageData.join('') : imageData;
              previewHTML += `<img src="data:image/png;base64,${imageSrc}" class="fireworks-output-image" alt="Output image" />`;
              rendered = true;
            }
            if (!rendered && output.data['image/jpeg']) {
              const imageData = output.data['image/jpeg'];
              const imageSrc = Array.isArray(imageData) ? imageData.join('') : imageData;
              previewHTML += `<img src="data:image/jpeg;base64,${imageSrc}" class="fireworks-output-image" alt="Output image" />`;
              rendered = true;
            }
            if (!rendered && output.data['text/plain']) {
              const text = Array.isArray(output.data['text/plain']) ? output.data['text/plain'].join('') : output.data['text/plain'];
              previewHTML += `<pre class="fireworks-output">${escapeHtml(String(text))}</pre>`;
              rendered = true;
            }
            if (!rendered) {
              const dataTypes = Object.keys(output.data || {});
              console.warn(`🎆 Fireworks: Unhandled display_data data types:`, dataTypes);
            }
          }
          // Handle error output
          else if (output.output_type === 'error') {
            const errorName = output.ename || 'Error';
            const errorValue = output.evalue || '';
            const traceback = Array.isArray(output.traceback) ? output.traceback.join('\n') : (output.traceback || '');
            previewHTML += `<div class="fireworks-output-error">
              <div class="fireworks-error-name">${escapeHtml(errorName)}: ${escapeHtml(errorValue)}</div>
              <pre class="fireworks-error-traceback">${escapeHtml(traceback)}</pre>
            </div>`;
          }
          // Fallback for unknown output types
          else {
            console.warn(`🎆 Fireworks: Unknown output type:`, output.output_type, output);
            previewHTML += `<div class="fireworks-output-debug">Output type: ${output.output_type || 'unknown'}</div>`;
          }
        });
        previewHTML += '</div>';
      }
      
      previewHTML += '</div>';
    } else if (cell.cell_type === 'markdown') {
      const markdownText = Array.isArray(cell.source) ? cell.source.join('') : (cell.source || '');
      const rendered = renderMarkdown(markdownText);
      previewHTML += `
        <div class="fireworks-markdown">
          ${rendered}
        </div>
      `;
    }
  });
  
  previewHTML += '</div>';
  
  // Get width value BEFORE creating elements
  const container = document.getElementById('fireworks-viewer-container');
  const widthSlider = container ? container.querySelector('#fireworks-width-slider') : null;
  const width = Math.max(50, Math.min(100, parseInt(widthSlider?.value) || 60));
  const contentArea = container ? container.querySelector('#fireworks-content-zoomable') : null;
  
  // Calculate width BEFORE inserting into DOM
  let targetMaxWidth = null;
  if (contentArea) {
    void contentArea.offsetWidth; // Force reflow
    const contentAreaWidth = contentArea.offsetWidth || contentArea.clientWidth;
    if (contentAreaWidth > 0) {
      const availableWidth = contentAreaWidth - 40;
      targetMaxWidth = (availableWidth * width / 100) + 'px';
    } else {
      // Use viewer container as fallback
      const viewerWidth = container ? (container.offsetWidth || container.clientWidth) : 0;
      if (viewerWidth > 0) {
        const estimatedContentWidth = viewerWidth * 0.8;
        const availableWidth = estimatedContentWidth - 40;
        targetMaxWidth = (availableWidth * width / 100) + 'px';
      } else {
        targetMaxWidth = width + '%';
      }
    }
  } else {
    targetMaxWidth = width + '%';
  }
  
  // Replace the loading div entirely with the cells container
  // This ensures the flex properties of .fireworks-loading don't interfere
  let cellsContainer = null;
  if (loading && loading.parentElement) {
    // Create a new container for the cells
    const cellsWrapper = document.createElement('div');
    cellsWrapper.className = 'fireworks-cells-wrapper';
    cellsWrapper.innerHTML = previewHTML;
    
    // Get the cells container BEFORE inserting into DOM
    cellsContainer = cellsWrapper.querySelector('.fireworks-cells');
    
    // Apply styles BEFORE inserting into DOM to prevent CSS from expanding it
    if (cellsContainer) {
      cellsContainer.style.setProperty('min-width', '0', 'important');
      cellsContainer.style.setProperty('width', '100%', 'important');
      cellsContainer.style.setProperty('margin', '0 auto', 'important');
      cellsContainer.style.setProperty('max-width', targetMaxWidth, 'important');
      console.log('🎆 Fireworks: Applied cell width BEFORE DOM insertion:', targetMaxWidth, '(', width + '%)');
    }
    
    // NOW insert into DOM with styles already applied
    loading.parentElement.replaceChild(cellsWrapper, loading);
  } else {
    // Fallback: just set innerHTML if parent not found
    loading.innerHTML = previewHTML;
    cellsContainer = loading.querySelector('.fireworks-cells');
    if (cellsContainer) {
      cellsContainer.style.setProperty('min-width', '0', 'important');
      cellsContainer.style.setProperty('width', '100%', 'important');
      cellsContainer.style.setProperty('margin', '0 auto', 'important');
      cellsContainer.style.setProperty('max-width', targetMaxWidth, 'important');
      console.log('🎆 Fireworks: Applied cell width after innerHTML:', targetMaxWidth, '(', width + '%)');
    }
  }
  
  // Also apply via the function to ensure it's correct after layout completes
  // Use multiple requestAnimationFrame calls to ensure DOM and layout are fully updated
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        applyCellWidthFromSlider();
      });
    });
  });
  
  const footer = document.createElement('div');
  footer.className = 'fireworks-footer';
  footer.innerHTML = `
    <p>Tip: For full functionality and to run cells, download the notebook and use Jupyter locally.</p>
  `;
  const footerContentArea = document.querySelector('#fireworks-content-zoomable') || 
                            document.querySelector('.fireworks-content');
  if (footerContentArea) {
    footerContentArea.appendChild(footer);
  }
  
  // Search and highlight saved text if available
  const browserAPI = BROWSER === 'chrome' ? chrome : browser;
  const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
  storageAPI.get(['fireworksSearchText'], (result) => {
    if (!browserAPI.runtime.lastError && result && result.fireworksSearchText) {
      const searchText = result.fireworksSearchText.trim();
      if (searchText) {
        console.log("🎆 Fireworks: Search text loaded from settings:", searchText);
        // Wait for content to be fully rendered, with retry logic
        let retryCount = 0;
        const maxRetries = 15; // Increased retries
        const tryHighlight = () => {
          const content = document.querySelector('#fireworks-content-zoomable') || 
                          document.querySelector('.fireworks-content');
          const textContent = content ? (content.textContent || content.innerText || '') : '';
          // Use case-insensitive search
          const searchRegex = new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          
          if (content && textContent && searchRegex.test(textContent)) {
            console.log("🎆 Fireworks: Content ready, attempting highlight");
            highlightAndScrollToText(searchText);
          } else if (retryCount < maxRetries) {
            retryCount++;
            if (retryCount % 3 === 0) {
              console.log("🎆 Fireworks: Retrying highlight, attempt", retryCount, "of", maxRetries);
            }
            setTimeout(tryHighlight, 300); // Increased delay
          } else {
            console.log("🎆 Fireworks: Max retries reached, search text may not be in notebook");
          }
        };
        setTimeout(tryHighlight, 800); // Increased initial delay
      }
    } else {
      console.log("🎆 Fireworks: No search text in settings or error loading:", browserAPI.runtime.lastError);
    }
  });

  // Emit keyword/question/response debug on preview load as well.
  try {
    const extracted = extractStudentAnswers();
    const currentStudentResponse = Array.isArray(extracted) && extracted.length > 0 ? extracted[0].text : '';
    Promise.resolve(debugNotebookQuestionAndStudentResponse(currentStudentResponse, 'preview')).catch((err) => {
      console.error('🎆 Fireworks: Debug extraction after preview failed:', err);
    });
  } catch (err) {
    console.error('🎆 Fireworks: Could not read current student response for preview debug:', err);
  }
}

function highlightAndScrollToText(searchText) {
  const content = document.querySelector('#fireworks-content-zoomable') || 
                  document.querySelector('.fireworks-content');
  if (!content || !searchText) {
    console.log("🎆 Fireworks: highlightAndScrollToText - missing content or searchText");
    return;
  }
  
  // Normalize search text - remove extra spaces and make case-insensitive search
  const normalizedSearch = searchText.trim();
  if (!normalizedSearch) {
    console.log("🎆 Fireworks: Search text is empty after normalization");
    return;
  }
  
  // Search in text content first to find matches (case-insensitive)
  const textContent = content.textContent || content.innerText || '';
  const searchRegex = new RegExp(normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  
  if (!searchRegex.test(textContent)) {
    console.log("🎆 Fireworks: Search text not found in content:", normalizedSearch);
    console.log("🎆 Fireworks: Content preview:", textContent.substring(0, 200));
    return; // Text not found
  }
  
  console.log("🎆 Fireworks: Found search text, highlighting:", normalizedSearch);
  
  // Get all text nodes and their parent elements to find where the text appears
  // This approach works better with rendered markdown
  const walker = document.createTreeWalker(
    content,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );
  
  const textNodes = [];
  let node;
  while (node = walker.nextNode()) {
    if (node.textContent && searchRegex.test(node.textContent)) {
      textNodes.push(node);
    }
  }
  
  // If we found text nodes, highlight the first one's parent element
  if (textNodes.length > 0) {
    const firstTextNode = textNodes[0];
    let parentElement = firstTextNode.parentElement;
    
    // Find a suitable parent to highlight (prefer block elements)
    while (parentElement && parentElement !== content) {
      if (parentElement.tagName && ['DIV', 'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE', 'CODE'].includes(parentElement.tagName)) {
        break;
      }
      parentElement = parentElement.parentElement;
    }
    
    if (parentElement && parentElement !== content) {
      // Highlight the entire element
      parentElement.style.backgroundColor = 'yellow';
      parentElement.style.transition = 'background-color 0.3s';
      parentElement.setAttribute('data-fireworks-highlighted', 'true');
      
      // Scroll to it - use rAF to ensure zoom/layout is applied before scrolling
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Flash effect
          setTimeout(() => {
            parentElement.style.backgroundColor = '#ffff00';
            setTimeout(() => {
              parentElement.style.backgroundColor = 'yellow';
              // Fade out after 3 seconds
              setTimeout(() => {
                parentElement.style.backgroundColor = '';
                parentElement.removeAttribute('data-fireworks-highlighted');
              }, 3000);
            }, 300);
          }, 100);
        });
      });
      
      console.log("🎆 Fireworks: Successfully highlighted and scrolled to:", normalizedSearch);
      return;
    }
  }
  
  // Fallback: Use regex replacement on HTML (but be careful with HTML tags)
  const contentHTML = content.innerHTML;
  const escapedSearch = normalizedSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedSearch})`, 'gi');
  
  // Only replace if not inside HTML tags
  const highlightedHTML = contentHTML.replace(regex, (match, p1, offset, string) => {
    // Check if we're inside an HTML tag
    const before = string.substring(0, offset);
    const after = string.substring(offset + match.length);
    const lastOpenTag = before.lastIndexOf('<');
    const lastCloseTag = before.lastIndexOf('>');
    
    // If we're inside a tag (between < and >), don't replace
    if (lastOpenTag > lastCloseTag) {
      return match;
    }
    
    return '<mark style="background-color: yellow; color: black; padding: 2px 0;">' + p1 + '</mark>';
  });
  
  content.innerHTML = highlightedHTML;
  
  // Find first match and scroll to it - use rAF so zoom/layout is applied before scrolling
  const firstMatch = content.querySelector('mark');
  if (firstMatch) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        firstMatch.scrollIntoView({ behavior: 'smooth', block: 'center' });
        firstMatch.style.transition = 'background-color 0.3s';
        setTimeout(() => {
          firstMatch.style.backgroundColor = '#ffff00';
          setTimeout(() => {
            firstMatch.style.backgroundColor = 'yellow';
          }, 300);
        }, 100);
      });
    });
    console.log("🎆 Fireworks: Successfully highlighted using fallback method");
  } else {
    console.log("🎆 Fireworks: Could not find match element after HTML replacement");
  }
}

function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Helper function to apply inline formatting (bold, italic, links, LaTeX)
function applyInlineFormatting(text) {
  // LaTeX inline math: $...$ or \(...\)
  // Extract LaTeX first to avoid processing markdown inside it
  const latexBlocks = [];
  text = text.replace(/\$([^$\n]+?)\$/g, (match, math) => {
    const placeholder = `🔥LATEX${latexBlocks.length}🔥`;
    latexBlocks.push(math);
    return placeholder;
  });
  text = text.replace(/\\\(([^)]+?)\\\)/g, (match, math) => {
    const placeholder = `🔥LATEX${latexBlocks.length}🔥`;
    latexBlocks.push(math);
    return placeholder;
  });
  
  // LaTeX display math: $$...$$ or \[...\]
  const latexDisplay = [];
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
    const placeholder = `🔥LATEXD${latexDisplay.length}🔥`;
    latexDisplay.push(math);
    return placeholder;
  });
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (match, math) => {
    const placeholder = `🔥LATEXD${latexDisplay.length}🔥`;
    latexDisplay.push(math);
    return placeholder;
  });
  
  // Bold+Italic (triple asterisks) - must come first
  text = text.replace(/\*\*\*([^*]+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  text = text.replace(/___([^_]+?)___/g, '<strong><em>$1</em></strong>');
  
  // Bold (double asterisks or underscores) - must come before italic
  text = text.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/__([^_]+?)__/g, '<strong>$1</strong>');
  
  // Italic (single asterisks) - handle cases like *6.2.1 text*
  // Process after bold to avoid conflicts
  text = text.replace(/\*([^*\n<>]+?)\*/g, (match, content) => {
    // Skip if already processed (contains HTML tags)
    if (match.includes('<') || match.includes('>')) {
      return match;
    }
    return `<em>${content}</em>`;
  });
  
  // Italic with underscores
  text = text.replace(/_([^_\n<>]+?)_/g, (match, content) => {
    // Skip if already processed
    if (match.includes('<') || match.includes('>')) {
      return match;
    }
    // Don't match single underscores
    if (content.trim().length === 0) {
      return match;
    }
    return `<em>${content}</em>`;
  });
  
  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Restore LaTeX display math
  // Note: math content may have escaped backslashes (\\frac) which should be preserved
  latexDisplay.forEach((math, idx) => {
    // Don't escape HTML in LaTeX - preserve backslashes and special characters
    // Just escape basic HTML entities that could break rendering
    const safeMath = math.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(`🔥LATEXD${idx}🔥`, `<div class="fireworks-latex-display">$$${safeMath}$$</div>`);
  });
  
  // Restore LaTeX inline math
  latexBlocks.forEach((math, idx) => {
    // Don't escape HTML in LaTeX - preserve backslashes and special characters
    const safeMath = math.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    text = text.replace(`🔥LATEX${idx}🔥`, `<span class="fireworks-latex-inline">$${safeMath}$</span>`);
  });
  
  return text;
}

// Simple markdown renderer for notebook preview
function renderMarkdown(markdown) {
  if (!markdown || markdown.trim() === '') {
    return '<p></p>';
  }
  
  let text = String(markdown);
  
  // Extract code blocks first (before any processing)
  const codeBlocks = [];
  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (match, lang, code) => {
    const placeholder = `🔥CB${codeBlocks.length}🔥`;
    codeBlocks.push({ lang: lang || '', code: escapeHtml(code) });
    return placeholder;
  });
  
  // Extract inline code
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (match, code) => {
    const placeholder = `🔥IC${inlineCodes.length}🔥`;
    inlineCodes.push(escapeHtml(code));
    return placeholder;
  });
  
  // Process line by line
  const lines = text.split('\n');
  const result = [];
  let inList = false;
  let listType = null;
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    
    // Headers (check from most specific to least)
    if (/^######\s+/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      let headerText = trimmed.replace(/^######\s+/, '');
      headerText = applyInlineFormatting(headerText);
      result.push(`<h6>${headerText}</h6>`);
      continue;
    }
    if (/^#####\s+/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      let headerText = trimmed.replace(/^#####\s+/, '');
      headerText = applyInlineFormatting(headerText);
      result.push(`<h5>${headerText}</h5>`);
      continue;
    }
    if (/^####\s+/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      let headerText = trimmed.replace(/^####\s+/, '');
      headerText = applyInlineFormatting(headerText);
      result.push(`<h4>${headerText}</h4>`);
      continue;
    }
    if (/^###\s+/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      let headerText = trimmed.replace(/^###\s+/, '');
      headerText = applyInlineFormatting(headerText);
      result.push(`<h3>${headerText}</h3>`);
      continue;
    }
    if (/^##\s+/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      let headerText = trimmed.replace(/^##\s+/, '');
      headerText = applyInlineFormatting(headerText);
      result.push(`<h2>${headerText}</h2>`);
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      let headerText = trimmed.replace(/^#\s+/, '');
      headerText = applyInlineFormatting(headerText);
      result.push(`<h1>${headerText}</h1>`);
      continue;
    }
    
    // Horizontal rule
    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      if (inList) {
        result.push(listType === 'ul' ? '</ul>' : '</ol>');
        inList = false;
      }
      result.push('<hr>');
      continue;
    }
    
    // Lists
    if (/^[\*\-\+]\s+/.test(trimmed)) {
      if (!inList || listType !== 'ul') {
        if (inList) result.push('</ol>');
        result.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      let listText = trimmed.replace(/^[\*\-\+]\s+/, '');
      listText = escapeHtml(listText);
      // Restore inline code in list items
      inlineCodes.forEach((ic, idx) => {
        listText = listText.replace(`🔥IC${idx}🔥`, `<code>${ic}</code>`);
      });
      listText = applyInlineFormatting(listText);
      result.push(`<li>${listText}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      if (!inList || listType !== 'ol') {
        if (inList) result.push('</ul>');
        result.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      let listText = trimmed.replace(/^\d+\.\s+/, '');
      listText = escapeHtml(listText);
      // Restore inline code in list items
      inlineCodes.forEach((ic, idx) => {
        listText = listText.replace(`🔥IC${idx}🔥`, `<code>${ic}</code>`);
      });
      listText = applyInlineFormatting(listText);
      result.push(`<li>${listText}</li>`);
      continue;
    }
    
    // Close list
    if (inList && trimmed !== '') {
      result.push(listType === 'ul' ? '</ul>' : '</ol>');
      inList = false;
    }
    
    // Empty line
    if (trimmed === '') {
      continue;
    }
    
    // Regular text - escape first
    let processed = escapeHtml(line);
    
    // Restore code blocks
    codeBlocks.forEach((cb, idx) => {
      processed = processed.replace(`🔥CB${idx}🔥`, `<pre><code class="language-${cb.lang}">${cb.code}</code></pre>`);
    });
    
    // Restore inline code
    inlineCodes.forEach((ic, idx) => {
      processed = processed.replace(`🔥IC${idx}🔥`, `<code>${ic}</code>`);
    });
    
    // Apply formatting (but not inside code blocks/code)
    processed = applyInlineFormatting(processed);
    
    // Wrap in paragraph if not already a block element
    if (!processed.match(/^<(h[1-6]|pre|ul|ol|li|hr)/)) {
      result.push(`<p>${processed}</p>`);
    } else {
      result.push(processed);
    }
  }
  
  // Close any open list
  if (inList) {
    result.push(listType === 'ul' ? '</ul>' : '</ol>');
  }
  
  return result.join('\n');
}

// Track if we've already injected to prevent duplicates
let injectionAttempted = false;
let buttonInjected = false;

// Track current page state for auto-reload feature
let currentPageUrl = window.location.href;
let currentNotebookUrl = null;
let viewerIsOpen = false;
let fireworksNotebookCache = { url: null, notebook: null };
let fireworksSubmissionResponses = [];

function getNotebookCellSourceText(cell) {
  if (!cell || !cell.source) return '';
  return Array.isArray(cell.source) ? cell.source.join('') : String(cell.source);
}

function normalizeKeywordCellOffset(offsetRaw) {
  const parsed = parseInt(String(offsetRaw ?? ''), 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(-50, Math.min(50, parsed));
}

function findQuestionCellByKeywordsInNotebook(notebook, keywordsRaw, cellOffsetRaw = 1) {
  if (!notebook || !Array.isArray(notebook.cells)) {
    return { keywordCell: null, questionCell: null, keywordCellIndex: -1, questionCellIndex: -1, usedOffset: normalizeKeywordCellOffset(cellOffsetRaw) };
  }
  const normalizedKeywords = String(keywordsRaw || '').trim().toLowerCase();
  const cellOffset = normalizeKeywordCellOffset(cellOffsetRaw);
  if (!normalizedKeywords) {
    return { keywordCell: null, questionCell: null, keywordCellIndex: -1, questionCellIndex: -1, usedOffset: cellOffset };
  }

  const cells = notebook.cells;
  const keywordTokens = normalizedKeywords.split(/\s+/).filter(Boolean);

  for (let i = 0; i < cells.length; i += 1) {
    const currentText = getNotebookCellSourceText(cells[i]).toLowerCase();
    if (!currentText) continue;
    const matches = keywordTokens.every((token) => currentText.includes(token));
    if (!matches) continue;

    const questionIdx = i + cellOffset;
    const questionCell = questionIdx >= 0 && questionIdx < cells.length ? cells[questionIdx] : null;
    return {
      keywordCell: cells[i],
      questionCell: questionCell,
      keywordCellIndex: i,
      questionCellIndex: questionCell ? questionIdx : -1,
      usedOffset: cellOffset
    };
  }

  return { keywordCell: null, questionCell: null, keywordCellIndex: -1, questionCellIndex: -1, usedOffset: cellOffset };
}

function parseStudentResponseForDebug(rawResponse) {
  const raw = String(rawResponse || '').trim();
  if (!raw) {
    return { format: 'empty', parsed: null };
  }

  const tryParseJson = (value) => {
    try {
      return { ok: true, value: JSON.parse(value) };
    } catch (e) {
      return { ok: false, value: null };
    }
  };

  const direct = tryParseJson(raw);
  if (direct.ok) {
    return { format: 'json', parsed: direct.value };
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) {
    const fencedParsed = tryParseJson(fenced[1].trim());
    if (fencedParsed.ok) {
      return { format: 'fenced_json', parsed: fencedParsed.value };
    }
  }

  return { format: 'text', parsed: raw };
}

function getSubmissionProgressFromPage() {
  const selectors = [
    '[data-testid*="submission"]',
    '[class*="submission"]',
    '[class*="Submission"]',
    'h1',
    'h2',
    'h3',
    'header',
    'main'
  ];

  const matcher = /Submission:\s*(\d+)\s*of\s*(\d+)/i;
  for (const selector of selectors) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const text = String(node?.textContent || '').trim();
      if (!text) continue;
      const match = text.match(matcher);
      if (match) {
        return {
          current: parseInt(match[1], 10),
          total: parseInt(match[2], 10),
          source: 'dom_selector',
          rawText: text
        };
      }
    }
  }

  // Fallback: scan the whole body text.
  const bodyText = String(document.body?.innerText || '');
  const bodyMatch = bodyText.match(matcher);
  if (bodyMatch) {
    return {
      current: parseInt(bodyMatch[1], 10),
      total: parseInt(bodyMatch[2], 10),
      source: 'body_text',
      rawText: bodyMatch[0]
    };
  }

  return null;
}

function appendSubmissionResponseJson({ submissionMeta, responseRaw, responseParsed }) {
  if (!submissionMeta || !Number.isFinite(submissionMeta.current)) {
    return null;
  }

  const entry = {
    submission: submissionMeta.current,
    total: Number.isFinite(submissionMeta.total) ? submissionMeta.total : null,
    responseRaw: String(responseRaw || ''),
    responseFormat: responseParsed?.format || 'unknown',
    responseParsed: responseParsed ? responseParsed.parsed : null,
    capturedAt: new Date().toISOString()
  };

  const existingIdx = fireworksSubmissionResponses.findIndex((item) => item.submission === entry.submission);
  if (existingIdx >= 0) {
    fireworksSubmissionResponses[existingIdx] = entry;
  } else {
    fireworksSubmissionResponses.push(entry);
  }

  return entry;
}

async function extractStudentResponseFromNotebookBySettings() {
  const browserRuntime = BROWSER === 'chrome' ? chrome : browser;
  const storageAPI = browserRuntime.storage.local || browserRuntime.storage.sync;

  const settings = await new Promise((resolve) => {
    storageAPI.get(['fireworksSearchText', 'fireworksKeywordCellOffset'], (result) => {
      if (browserRuntime.runtime.lastError) {
        resolve({ fireworksSearchText: '', fireworksKeywordCellOffset: 1 });
        return;
      }
      resolve(result || {});
    });
  });

  const keywords = String(settings.fireworksSearchText || '').trim();
  const keywordCellOffset = normalizeKeywordCellOffset(settings.fireworksKeywordCellOffset);
  if (!keywords) return '';

  let notebookUrl = currentNotebookUrl;
  if (!notebookUrl) {
    const notebookLink = Array.from(document.querySelectorAll('a')).find((a) => isNotebookFile(String(a?.href || '')));
    notebookUrl = notebookLink ? notebookLink.href : null;
  }
  if (!notebookUrl) return '';

  let notebook = null;
  if (fireworksNotebookCache.url === notebookUrl && fireworksNotebookCache.notebook) {
    notebook = fireworksNotebookCache.notebook;
  } else {
    const fetchResult = await new Promise((resolve) => {
      browserRuntime.runtime.sendMessage(
        { action: 'fetchNotebook', url: notebookUrl, connections: 20 },
        (response) => resolve(response || null)
      );
    });
    if (fetchResult && fetchResult.success && fetchResult.notebook) {
      notebook = fetchResult.notebook;
      fireworksNotebookCache = { url: notebookUrl, notebook: notebook };
    }
  }

  if (!notebook) return '';

  const questionMatch = findQuestionCellByKeywordsInNotebook(notebook, keywords, keywordCellOffset);
  if (!questionMatch.questionCell) return '';
  return String(getNotebookCellSourceText(questionMatch.questionCell) || '').trim();
}

async function debugNotebookQuestionAndStudentResponse(currentAnswer, source = 'unknown') {
  const browserRuntime = BROWSER === 'chrome' ? chrome : browser;
  const storageAPI = browserRuntime.storage.local || browserRuntime.storage.sync;

  const settings = await new Promise((resolve) => {
    storageAPI.get(['fireworksSearchText', 'fireworksKeywordCellOffset'], (result) => {
      if (browserRuntime.runtime.lastError) {
        resolve({ fireworksSearchText: '', fireworksKeywordCellOffset: 1 });
        return;
      }
      resolve(result || {});
    });
  });

  const keywords = String(settings.fireworksSearchText || '').trim();
  const keywordCellOffset = normalizeKeywordCellOffset(settings.fireworksKeywordCellOffset);
  if (!keywords) {
    console.debug('🎆 Fireworks Debug: No keywords set in gear settings.', { source, keywordCellOffset });
    return;
  }

  let notebookUrl = currentNotebookUrl;
  if (!notebookUrl) {
    const notebookLink = Array.from(document.querySelectorAll('a')).find((a) => {
      const href = String(a?.href || '').toLowerCase();
      return href.includes('.ipynb') && !href.includes('.pdf') && !href.endsWith('/pdf');
    });
    notebookUrl = notebookLink ? notebookLink.href : null;
  }

  if (!notebookUrl) {
    console.debug('🎆 Fireworks Debug: Notebook URL not found for keyword lookup.', { source });
    return;
  }

  let notebook = null;
  if (fireworksNotebookCache.url === notebookUrl && fireworksNotebookCache.notebook) {
    notebook = fireworksNotebookCache.notebook;
  } else {
    const fetchResult = await new Promise((resolve) => {
      browserRuntime.runtime.sendMessage(
        { action: 'fetchNotebook', url: notebookUrl, connections: 20 },
        (response) => resolve(response || null)
      );
    });
    if (fetchResult && fetchResult.success && fetchResult.notebook) {
      notebook = fetchResult.notebook;
      fireworksNotebookCache = { url: notebookUrl, notebook: notebook };
    }
  }

  if (!notebook) {
    const missingNotebookPayload = {
      keywords,
      notebookUrl
    };
    console.debug('🎆 Fireworks Debug: Notebook JSON unavailable for keyword lookup.', { source, ...missingNotebookPayload });
    return;
  }

  const questionMatch = findQuestionCellByKeywordsInNotebook(notebook, keywords, keywordCellOffset);
  const parsedResponse = parseStudentResponseForDebug(currentAnswer);
  const submissionMeta = getSubmissionProgressFromPage();
  const appendedEntry = appendSubmissionResponseJson({
    submissionMeta,
    responseRaw: currentAnswer,
    responseParsed: parsedResponse
  });
  const payload = {
    questionCellSource: questionMatch.questionCell ? getNotebookCellSourceText(questionMatch.questionCell) : null,
    current: submissionMeta && Number.isFinite(submissionMeta.current) ? submissionMeta.current : null,
    total: submissionMeta && Number.isFinite(submissionMeta.total) ? submissionMeta.total : null
  };

  console.debug('🎆 Fireworks Debug: Notebook question and student response', payload);
}

// Watch for dynamically added notebook links and page navigation
function setupLinkWatcher() {
  let checkTimeout = null;
  
  const checkAndReinject = () => {
    const existingButton = document.getElementById('fireworks-preview-btn');
    const notebookLinksCheck = Array.from(document.querySelectorAll('a')).filter(a => {
      const href = a.href || '';
      return href.includes('.ipynb');
    });
    
    if (!existingButton && notebookLinksCheck.length > 0) {
      console.log("🎆 Fireworks: Notebook links found but buttons missing, re-injecting");
      // Reset injection flag to allow re-injection
      buttonInjected = false;
      injectionAttempted = false;
      interceptNotebookDownloads();
      setTimeout(() => injectFireworksButton(), 200);
    }
  };
  
  const observer = new MutationObserver((mutations) => {
    let shouldRecheck = false;
    let shouldReinject = false;
    let buttonsRemoved = false;
    
    mutations.forEach((mutation) => {
      // Check for removed nodes (buttons might have been removed)
      if (mutation.removedNodes && mutation.removedNodes.length > 0) {
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === 1) {
            if (node.id === 'fireworks-preview-btn' || node.id === 'fireworks-settings-btn-page' ||
                node.querySelector && (node.querySelector('#fireworks-preview-btn') || node.querySelector('#fireworks-settings-btn-page'))) {
              buttonsRemoved = true;
              shouldReinject = true;
            }
          }
        });
      }
      
      // Check for added nodes
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Check if it's a link or contains links (exclude PDFs)
          const hrefLower = node.href ? node.href.toLowerCase() : '';
          if (node.tagName === 'A' && node.href && hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf')) {
            shouldRecheck = true;
            shouldReinject = true;
          } else if (node.querySelectorAll) {
            const notebookLinks = node.querySelectorAll('a[href*=".ipynb"]');
            const hasRealNotebook = Array.from(notebookLinks).some(link => {
              const linkHref = (link.href || '').toLowerCase();
              return linkHref.includes('.ipynb') && !linkHref.includes('.pdf');
            });
            if (hasRealNotebook) {
              shouldRecheck = true;
              shouldReinject = true;
            }
          }
          
          // Check if buttons were removed (e.g., page navigation)
          if (node.querySelector && !node.querySelector('#fireworks-preview-btn')) {
            // Check if there are notebook links but no buttons (exclude PDFs)
            const notebookLinks = node.querySelectorAll('a[href*=".ipynb"]');
            const hasRealNotebook = Array.from(notebookLinks).some(link => {
              const linkHref = (link.href || '').toLowerCase();
              return linkHref.includes('.ipynb') && !linkHref.includes('.pdf');
            });
            if (hasRealNotebook) {
              shouldReinject = true;
            }
          }
        }
      });
    });
    
    if (shouldRecheck || buttonsRemoved) {
      interceptNotebookDownloads();
    }
    
    // Debounce re-injection checks
    if (shouldReinject || buttonsRemoved) {
      if (checkTimeout) clearTimeout(checkTimeout);
      checkTimeout = setTimeout(checkAndReinject, 300);
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false
  });
  
  // Also set up periodic check as backup
  const periodicCheck = setInterval(() => {
    const existingButton = document.getElementById('fireworks-preview-btn');
    const notebookLinksCheck = Array.from(document.querySelectorAll('a')).filter(a => {
      const href = a.href || '';
      const hrefLower = href.toLowerCase();
      return hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
    });
    
    if (!existingButton && notebookLinksCheck.length > 0) {
      console.log("🎆 Fireworks: Periodic check - buttons missing, re-injecting");
      buttonInjected = false;
      injectionAttempted = false;
      interceptNotebookDownloads();
      injectFireworksButton();
    }
  }, 2000); // Check every 2 seconds
  
  // Listen for SPA navigation events
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  
  const handleNavigation = () => {
    const newUrl = window.location.href;
    
    // Check if page actually changed (not just a hash change)
    if (newUrl !== currentPageUrl) {
      console.log("🎆 Fireworks: Page navigation detected:", newUrl);
      currentPageUrl = newUrl;
      
      // If viewer is open, automatically reload with new student's notebook
      if (viewerIsOpen && document.getElementById('fireworks-viewer-container')) {
        console.log("🎆 Fireworks: Viewer is open, auto-reloading new student's notebook");
        setTimeout(() => {
          const newNotebookLinks = Array.from(document.querySelectorAll('a')).filter(a => {
            const href = a.href || '';
            const hrefLower = href.toLowerCase();
            return hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
          });
          
          if (newNotebookLinks.length > 0) {
            const newDownloadUrl = newNotebookLinks[0].href;
            const newFileName = extractFileName(newDownloadUrl);
            
            // Only reload if it's a different notebook
            if (newDownloadUrl !== currentNotebookUrl) {
              console.log("🎆 Fireworks: New notebook detected, reloading viewer");
              injectViewer(newDownloadUrl, newFileName);
            } else {
              console.log("🎆 Fireworks: Same notebook URL, skipping reload");
            }
          } else {
            console.log("🎆 Fireworks: No notebook link found on new page");
          }
        }, 800); // Wait for page to load
      }
    }
    
    setTimeout(checkAndReinject, 500);
  };
  
  history.pushState = function() {
    originalPushState.apply(history, arguments);
    handleNavigation();
  };
  
  history.replaceState = function() {
    originalReplaceState.apply(history, arguments);
    handleNavigation();
  };
  
  window.addEventListener('popstate', () => {
    handleNavigation();
  });
  
  // Also monitor URL changes via MutationObserver (for Gradescope's 'z' key navigation)
  // Gradescope might update the page content without using history API
  let urlCheckInterval = setInterval(() => {
    const newUrl = window.location.href;
    if (newUrl !== currentPageUrl) {
      console.log("🎆 Fireworks: URL change detected via polling:", newUrl);
      handleNavigation();
    }
  }, 1000); // Check every second
  
  console.log("🎆 Fireworks: Link watcher set up with enhanced navigation detection and auto-reload");
}

// Try multiple ways to trigger injection
function tryInject() {
  // Always allow re-injection if buttons don't exist
  const existingButton = document.getElementById('fireworks-preview-btn');
  if (injectionAttempted && existingButton) {
    console.log("🎆 Fireworks: Injection already attempted and button exists, skipping");
    return;
  }
  
  // Reset flag if button doesn't exist
  if (!existingButton) {
    injectionAttempted = false;
    buttonInjected = false;
  }
  
  injectionAttempted = true;
  console.log("🎆 Fireworks: Attempting injection...");
  injectFireworksButton();
  setupLinkWatcher();
}

// Method 1: DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  console.log("🎆 Fireworks: DOMContentLoaded event fired");
  setTimeout(tryInject, 1000);
});

// Method 2: Immediate (in case DOM is already loaded)
if (document.readyState === 'loading') {
  console.log("🎆 Fireworks: Document still loading");
} else {
  console.log("🎆 Fireworks: Document already loaded, injecting immediately");
  setTimeout(tryInject, 1000);
}

// Method 3: Window load
window.addEventListener('load', () => {
  console.log("🎆 Fireworks: Window load event fired");
  setTimeout(tryInject, 1000);
});

// Intercept notebook download links to show preview instead
function interceptNotebookDownloads() {
  // Find all notebook links (exclude PDFs)
  const notebookLinks = Array.from(document.querySelectorAll('a')).filter(a => {
    const href = a.href || '';
    const hrefLower = href.toLowerCase();
    // Must contain .ipynb but NOT be a PDF
    return hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
  });
  
  console.log("🎆 Fireworks: Intercepting", notebookLinks.length, "notebook download links");
  
  notebookLinks.forEach((link, index) => {
    // Skip if already intercepted
    if (link.dataset.fireworksIntercepted === 'true') {
      console.log(`🎆 Fireworks: Link ${index} already intercepted, skipping`);
      return;
    }
    
    // Mark as intercepted
    link.dataset.fireworksIntercepted = 'true';
    
    // Remove download attribute if present
    if (link.hasAttribute('download')) {
      link.removeAttribute('download');
      console.log(`🎆 Fireworks: Removed download attribute from link ${index}`);
    }
    
    // Add click interceptor with capture phase to intercept early
    link.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      const downloadUrl = this.href;
      const fileName = extractFileName(downloadUrl);
      
      console.log("🎆 Fireworks: Intercepted download, showing preview instead");
      console.log("🎆 Fireworks: URL:", downloadUrl);
      console.log("🎆 Fireworks: File name:", fileName);
      
      injectViewer(downloadUrl, fileName);
      
      return false;
    }, true); // Use capture phase to intercept before other handlers
    
    // Preview badge removed - no longer adding visual indicator
  });
}

function injectFireworksButton() {
  // Check if button already exists
  const existingPreviewBtn = document.getElementById('fireworks-preview-btn');
  if (existingPreviewBtn) {
    console.log("🎆 Fireworks: Preview button already exists, skipping injection");
    buttonInjected = true;
    return;
  }
  
  // Check if we're on an exam grading page (do this early)
  const isExamGradingPage = isGradescopeExamGradingPage();
  console.log("🎆 Fireworks: isExamGradingPage:", isExamGradingPage);
  
  // Also check if we're on a page with notebook links (exclude PDFs)
  const notebookLinksForInjection = Array.from(document.querySelectorAll('a')).filter(a => {
    const href = a.href || '';
    const hrefLower = href.toLowerCase();
    const text = a.textContent || '';
    // Must contain .ipynb but NOT be a PDF
    const isNotebook = hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
    return isNotebook || 
           (text.toLowerCase().includes('download') && hrefLower.includes('ipynb') && !hrefLower.includes('.pdf')) ||
           (text.toLowerCase().includes('notebook') && hrefLower.includes('download') && !hrefLower.includes('.pdf'));
  });
  
  // Allow injection on exam grading pages even without notebook links
  if (notebookLinksForInjection.length === 0 && !isExamGradingPage) {
    console.log("🎆 Fireworks: No notebook links found and not on exam grading page, skipping button injection");
    return;
  }
  
  const pageText = document.body.innerText || '';
  const hasLargeFile = pageText.includes('Large file hidden') || 
                       pageText.includes('large file') ||
                       pageText.includes('Large File');
  
  console.log("🎆 Fireworks: Page text check - hasLargeFile:", hasLargeFile);
  console.log("🎆 Fireworks: Page URL:", window.location.href);
  
  // Intercept notebook downloads first
  interceptNotebookDownloads();
  
  // Look for notebook download links more broadly (exclude PDFs)
  const notebookLinks = Array.from(document.querySelectorAll('a')).filter(a => {
    const href = a.href || '';
    const hrefLower = href.toLowerCase();
    const text = a.textContent || '';
    // Must contain .ipynb but NOT be a PDF
    const isNotebook = hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
    return isNotebook || 
           (text.toLowerCase().includes('download') && hrefLower.includes('ipynb') && !hrefLower.includes('.pdf')) ||
           (text.toLowerCase().includes('notebook') && hrefLower.includes('download') && !hrefLower.includes('.pdf'));
  });
  
  console.log("🎆 Fireworks: Found notebook links:", notebookLinks.length);
  
  // Try multiple strategies to find the download section
  let downloadSection = null;
  let downloadUrl = null;
  
  // Strategy 1: Find section with download link
  if (notebookLinks.length > 0) {
    downloadUrl = notebookLinks[0].href;
    downloadSection = notebookLinks[0].closest('div, section, article, .file, [class*="file"], [class*="download"]') || 
                      notebookLinks[0].parentElement;
    console.log("🎆 Fireworks: Found download section via link");
  }
  
  // Strategy 2: Look for common Gradescope patterns
  if (!downloadSection) {
    downloadSection = document.querySelector('[class*="download"]') || 
                      document.querySelector('[class*="file"]') ||
                      document.querySelector('a[download]')?.parentElement ||
                      document.querySelector('[data-testid*="download"]')?.parentElement;
    console.log("🎆 Fireworks: Found download section via selector");
  }
  
  // Strategy 3: Look near any .ipynb link
  if (!downloadSection && notebookLinks.length > 0) {
    downloadSection = notebookLinks[0].parentElement;
    console.log("🎆 Fireworks: Using link parent as download section");
  }
  
  // Strategy 4: Try to find main content area
  if (!downloadSection) {
    downloadSection = document.querySelector('main, [role="main"], .content, [class*="content"]') ||
                      document.querySelector('body');
    console.log("🎆 Fireworks: Using main content area");
  }
  
  // For exam grading pages, we can use any section or the body
  if (!downloadSection && isExamGradingPage) {
    downloadSection = document.querySelector('main, [role="main"], .content, [class*="content"]') ||
                      document.body;
    console.log("🎆 Fireworks: Using body for exam grading page");
  }
  
  if (downloadSection) {
    console.log("🎆 Fireworks: Injecting button into section");
    
    // Create button container with proper spacing
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 12px; align-items: center; margin: 10px 0; flex-wrap: wrap; position: relative; z-index: 9999;';
    
    // Preview button (purple) - always show when we inject, even on exam grading pages
    const btn = document.createElement('button');
    btn.id = 'fireworks-preview-btn';
    btn.className = 'fireworks-btn';
    btn.innerHTML = '🎆 Preview Notebook';
    btn.style.cssText = 'margin: 0; flex-shrink: 0;';
    
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      console.log('🎆 Fireworks: Preview button clicked');
      
      // Try to find download URL if we don't have it (exclude PDFs)
      if (!downloadUrl) {
        const links = Array.from(document.querySelectorAll('a')).filter(a => {
          const href = a.href || '';
          const hrefLower = href.toLowerCase();
          return hrefLower.includes('.ipynb') && !hrefLower.includes('.pdf') && !hrefLower.endsWith('/pdf');
        });
        downloadUrl = links[0]?.href;
      }
      
      if (downloadUrl) {
        const fileName = extractFileName(downloadUrl);
        console.log("🎆 Fireworks: Opening viewer with URL:", downloadUrl);
        injectViewer(downloadUrl, fileName);
      } else {
        alert('Could not find notebook download link. Please try clicking the notebook link directly.');
        console.error("🎆 Fireworks: No download URL found");
      }
      return false;
    }, true); // Use capture phase
    
    buttonContainer.appendChild(btn);
    
    // Settings button
    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'fireworks-settings-btn-page';
    settingsBtn.className = 'fireworks-settings-btn-page';
    settingsBtn.innerHTML = '⚙️';
    settingsBtn.title = 'Download Settings';
    settingsBtn.style.cssText = 'background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; padding: 10px 15px; border-radius: 6px; font-size: 16px; cursor: pointer; transition: all 0.3s ease; box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4); margin: 0; flex-shrink: 0; position: relative; z-index: 1000; pointer-events: auto;';
    
    settingsBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      console.log('🎆 Fireworks: Settings button clicked');
      showSettingsPanel();
      return false;
    }, true); // Use capture phase
    
    settingsBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
    }, true);
    
    // Exam grading button (only show on exam grading pages)
    if (isExamGradingPage) {
      console.log("🎆 Fireworks: Creating exam grading button");
      const examBtn = document.createElement('button');
      examBtn.id = 'fireworks-exam-grading-btn';
      examBtn.className = 'fireworks-btn';
      examBtn.innerHTML = '📝 Grade Exam with AI';
      examBtn.style.cssText = 'margin: 0; flex-shrink: 0; background: linear-gradient(135deg, #10b981 0%, #059669 100%); position: relative; z-index: 100000; pointer-events: auto;';
      
      // Diagnostics: sometimes Gradescope wrappers intercept clicks; log pointer/mouse too.
      examBtn.addEventListener('pointerdown', () => console.log('🎆 Fireworks: Exam button pointerdown'), true);
      examBtn.addEventListener('mousedown', () => console.log('🎆 Fireworks: Exam button mousedown'), true);

      const onExamBtnClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        console.log('🎆 Fireworks: Exam grading button clicked');
        try {
          injectExamGradingViewer();
        } catch (err) {
          console.error('🎆 Fireworks: injectExamGradingViewer crashed:', err);
          alert('Fireworks error opening exam grader. Check console for details.');
        }
        return false;
      };

      // Attach in both capture and bubble to maximize reliability.
      examBtn.addEventListener('click', onExamBtnClick, true);
      examBtn.addEventListener('click', onExamBtnClick, false);

      // Stop AI auto-grading button (visible on main page)
      const stopBtn = document.createElement('button');
      stopBtn.id = 'fireworks-stop-autograde-btn';
      stopBtn.className = 'fireworks-btn';
      stopBtn.innerHTML = '⏹ Stop AI Auto-Grading';
      // Hidden by default; shown only while GPT auto-grading is actively running
      stopBtn.style.cssText = 'margin-left: 8px; flex-shrink: 0; background: #f97316; color: white; display: none;';
      stopBtn.addEventListener(
        'click',
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          fireworksGptAutoStopRequested = true;
          console.log('🎆 Fireworks: Stop AI Auto-Grading button clicked');
          alert('AI auto-grading will stop after the current question finishes.');
          return false;
        },
        true
      );
      buttonContainer.appendChild(stopBtn);
      
      buttonContainer.appendChild(examBtn);
      console.log("🎆 Fireworks: Exam grading button appended to container");
    }
    
    buttonContainer.appendChild(settingsBtn);
    console.log("🎆 Fireworks: Button container ready with", buttonContainer.children.length, "buttons");
    
    // For exam grading pages, try to find a better insertion point
    if (isExamGradingPage) {
      console.log("🎆 Fireworks: Exam grading page - finding best insertion point");
      
      // Try to find the main grading area or question area
      const gradingSelectors = [
        '[class*="question"]',
        '[class*="Question"]',
        '[class*="grading"]',
        '[class*="Grading"]',
        '[class*="submission"]',
        '[class*="Submission"]',
        'main',
        '[role="main"]',
        '.content',
        '[class*="content"]'
      ];
      
      let bestLocation = null;
      for (const selector of gradingSelectors) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          // Check if element is visible
          const rect = el.getBoundingClientRect();
          const isVisible = rect.width > 0 && rect.height > 0 && 
                          window.getComputedStyle(el).display !== 'none' &&
                          window.getComputedStyle(el).visibility !== 'hidden';
          
          if (isVisible && el.offsetParent !== null) {
            bestLocation = el;
            console.log("🎆 Fireworks: Found visible location:", selector, el);
            break;
          }
        }
        if (bestLocation) break;
      }
      
      if (bestLocation) {
        // Insert at the beginning of the best location
        if (bestLocation.firstChild) {
          bestLocation.insertBefore(buttonContainer, bestLocation.firstChild);
        } else {
          bestLocation.appendChild(buttonContainer);
        }
        console.log("🎆 Fireworks: Inserted button container into best location");
      } else {
        // Fallback: insert at top of body
        console.log("🎆 Fireworks: No good location found, inserting at top of body");
        if (document.body.firstChild) {
          document.body.insertBefore(buttonContainer, document.body.firstChild);
        } else {
          document.body.appendChild(buttonContainer);
        }
      }
    } else {
      // Original logic for notebook pages
      // Always insert as sibling, never as child, to avoid click event conflicts
      // Check if downloadSection is a clickable element (like <a>)
      const isClickable = downloadSection.tagName === 'A' || 
                          downloadSection.onclick !== null ||
                          downloadSection.getAttribute('onclick') !== null;
      
      if (isClickable) {
        // If downloadSection is clickable, insert after it as a sibling
        console.log('🎆 Fireworks: downloadSection is clickable, inserting buttons as sibling');
        if (downloadSection.parentElement) {
          downloadSection.parentElement.insertBefore(buttonContainer, downloadSection.nextSibling);
        } else {
          // Fallback: insert after downloadSection
          downloadSection.after(buttonContainer);
        }
      } else if (downloadSection.nextSibling) {
        // Insert as sibling if possible
        downloadSection.parentElement.insertBefore(buttonContainer, downloadSection.nextSibling);
      } else {
        // Last resort: append as child, but add click blocker
        console.log('🎆 Fireworks: Appending buttons as child (last resort)');
        downloadSection.appendChild(buttonContainer);
        // Add click blocker to prevent parent clicks
        buttonContainer.addEventListener('click', (e) => {
          e.stopPropagation();
        }, true);
      }
    }
    
    // Debug: Check if button is actually visible
    setTimeout(() => {
      const examBtn = document.getElementById('fireworks-exam-grading-btn');
      if (examBtn) {
        const rect = examBtn.getBoundingClientRect();
        const isVisible = rect.width > 0 && rect.height > 0 && 
                        window.getComputedStyle(examBtn).display !== 'none' &&
                        window.getComputedStyle(examBtn).visibility !== 'hidden';
        console.log("🎆 Fireworks: Exam button visibility check:", {
          exists: !!examBtn,
          visible: isVisible,
          rect: { width: rect.width, height: rect.height, top: rect.top, left: rect.left },
          display: window.getComputedStyle(examBtn).display,
          visibility: window.getComputedStyle(examBtn).visibility,
          parent: examBtn.parentElement?.tagName,
          parentVisible: examBtn.parentElement ? window.getComputedStyle(examBtn.parentElement).display !== 'none' : 'N/A'
        });
      }
    }, 500);
    
    // Setup settings panel
    setupSettingsPanel();
    
    buttonInjected = true;
    console.log("🎆 Fireworks: Button injected successfully!");
  } else {
    console.warn("🎆 Fireworks: Could not find suitable location to inject button");
    console.log("🎆 Fireworks: Available elements:", {
      hasLargeFile,
      notebookLinks: notebookLinks.length,
      bodyText: pageText.substring(0, 200)
    });
  }
}

// Setup settings panel (shown as overlay)
function setupSettingsPanel() {
  // Check if panel already exists - if it does, ensure it has the search field
  const existing = document.getElementById('fireworks-settings-panel-page');
  if (existing) {
    // Check if search input exists, if not, recreate panel
    const searchInput = document.getElementById('fireworks-search-text-input-page');
    const offsetInput = document.getElementById('fireworks-keyword-offset-input-page');
    const gradedLoadBtn = document.getElementById('fireworks-graded-load');
    if (!searchInput || !offsetInput || !gradedLoadBtn) {
      // Panel exists but missing search field, remove and recreate
      existing.remove();
    } else {
      return; // Panel exists with all fields, use existing
    }
  }
  
  // Create settings panel overlay
  const panel = document.createElement('div');
  panel.id = 'fireworks-settings-panel-page';
  panel.className = 'fireworks-settings-panel-page';
  panel.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); z-index: 10001; display: none; align-items: center; justify-content: center;';
  
  // Load saved settings FIRST, then create panel with correct value
  // Use storage.local for unpacked extensions (works without permanent ID)
  const browserAPI = BROWSER === 'chrome' ? chrome : browser;
  const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
  storageAPI.get(['fireworksConnections', 'fireworksSearchText', 'fireworksKeywordCellOffset'], (result) => {
    if (browserAPI.runtime.lastError) {
      console.error('🎆 Fireworks: Error loading settings:', browserAPI.runtime.lastError);
      // Fallback to default if error
      const savedConnections = 20;
      const savedSearchText = '';
      const savedKeywordCellOffset = 1;
      createPanelWithValue(panel, savedConnections, savedSearchText, savedKeywordCellOffset);
      return;
    }
    const savedConnections = (result && result.fireworksConnections) ? result.fireworksConnections : 20;
    const savedSearchText = (result && result.fireworksSearchText) ? result.fireworksSearchText : '';
    const savedKeywordCellOffset = normalizeKeywordCellOffset(result && result.fireworksKeywordCellOffset);
    
    createPanelWithValue(panel, savedConnections, savedSearchText, savedKeywordCellOffset);
  });
}

function createPanelWithValue(panel, savedConnections, savedSearchText, savedKeywordCellOffset) {
  panel.innerHTML = `
      <div class="fireworks-settings-content-page" style="background: white; border-radius: 12px; padding: 25px; max-width: 400px; width: 90%; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);">
        <h4 style="margin: 0 0 20px 0; font-size: 18px; font-weight: 600; color: #333;">Fireworks Settings</h4>
        <label style="display: flex; align-items: center; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 15px;">
          Parallel Connections:
          <input type="number" id="fireworks-connections-input-page" min="1" max="50" value="${savedConnections}" style="width: 80px; margin-left: 10px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
        </label>
        <p style="font-size: 12px; color: #666; margin: 0 0 20px 0;">More connections = faster download (1-50)</p>
        <label style="display: flex; flex-direction: column; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 10px;">
          Search Text (e.g., "6.2.1"):
          <input type="text" id="fireworks-search-text-input-page" value="${savedSearchText || ''}" placeholder="Enter text to search in notebook" style="width: 100%; margin-top: 5px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
        </label>
        <p style="font-size: 12px; color: #666; margin: 0 0 10px 0;">This text will be highlighted when notebook opens (like Ctrl+F)</p>
        <label style="display: flex; flex-direction: column; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 10px;">
          Keyword Cell Offset (for extraction):
          <input type="number" id="fireworks-keyword-offset-input-page" min="-50" max="50" value="${normalizeKeywordCellOffset(savedKeywordCellOffset)}" style="width: 100%; margin-top: 5px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
        </label>
        <p style="font-size: 12px; color: #666; margin: 0 0 20px 0;">Target notebook cell index = keyword cell index + offset. Use 1 for the cell below keyword cell.</p>
        <hr style="margin: 10px 0 16px 0; border: none; border-top: 1px solid #eee;">
        <h4 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600; color: #333;">Gradescope Autopilot Grading</h4>
        <p style="font-size: 12px; color: #666; margin: 0 0 10px 0;">
          On Gradescope grading pages, this can repeatedly apply a rubric option and move to the next ungraded submission by simulating key presses.
        </p>
        <label style="display: flex; align-items: center; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 10px;">
          Rubric option number to apply (0-9):
          <input type="number" id="fireworks-autopilot-score" min="0" max="9" value="1" style="width: 60px; margin-left: 10px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
        </label>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
          <button id="fireworks-autopilot-start" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #10b981; color: white;">
            Start autopilot
          </button>
          <button id="fireworks-autopilot-stop" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #ef4444; color: white;">
            Stop autopilot
          </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
          <button id="fireworks-capture-start" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #2563eb; color: white;">
            Capture responses
          </button>
          <button id="fireworks-capture-stop" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #6b7280; color: white;">
            Stop capture
          </button>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;">
          <button id="fireworks-graded-load" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #7c3aed; color: white;">
            Load graded JSON
          </button>
          <button id="fireworks-graded-start" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #0891b2; color: white;">
            Start graded auto-apply
          </button>
          <button id="fireworks-graded-stop" style="padding: 6px 12px; border: none; border-radius: 4px; font-size: 13px; font-weight: 500; cursor: pointer; background: #6b7280; color: white;">
            Stop graded auto-apply
          </button>
        </div>
        <p id="fireworks-graded-json-status" style="font-size: 12px; color: #666; margin: 0 0 8px 0;">
          Graded JSON: Not loaded.
        </p>
        <p id="fireworks-autopilot-status" style="font-size: 12px; color: #666; margin: 0 0 16px 0;">
          Autopilot status: Idle
        </p>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px;">
          <button id="fireworks-settings-cancel-page" class="fireworks-settings-cancel-btn" style="padding: 8px 16px; border: none; border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer; background: #e0e0e0; color: #333;">Cancel</button>
          <button id="fireworks-settings-save-page" class="fireworks-settings-save-btn" style="padding: 8px 16px; border: none; border-radius: 4px; font-size: 14px; font-weight: 500; cursor: pointer; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white;">Save</button>
        </div>
      </div>
    `;
    
  document.body.appendChild(panel);
  
  // Setup event handlers after panel is added to DOM
  setupSettingsPanelHandlers(panel, savedConnections);
}

function setupSettingsPanelHandlers(panel, defaultValue) {
  // Close on background click
  panel.addEventListener('click', (e) => {
    if (e.target === panel) {
      panel.style.display = 'none';
    }
  });
  
  // Save button
  document.getElementById('fireworks-settings-save-page').addEventListener('click', () => {
    const connectionsInput = document.getElementById('fireworks-connections-input-page');
    const searchTextInput = document.getElementById('fireworks-search-text-input-page');
    const keywordOffsetInput = document.getElementById('fireworks-keyword-offset-input-page');
    const connections = parseInt(connectionsInput.value) || defaultValue || 20;
    const clampedConnections = Math.max(1, Math.min(50, connections));
    const searchText = (searchTextInput.value || '').trim();
    const keywordCellOffset = normalizeKeywordCellOffset(keywordOffsetInput ? keywordOffsetInput.value : 1);
    
    const browserAPI = BROWSER === 'chrome' ? chrome : browser;
    const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
    storageAPI.set({ 
      fireworksConnections: clampedConnections,
      fireworksSearchText: searchText,
      fireworksKeywordCellOffset: keywordCellOffset
    }, () => {
      if (browserAPI.runtime.lastError) {
        console.error('🎆 Fireworks: Error saving settings:', browserAPI.runtime.lastError);
        return;
      }
      panel.style.display = 'none';
    });
  });
  
  // Cancel button
  document.getElementById('fireworks-settings-cancel-page').addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // Autopilot controls (only present on some pages)
  const autopilotStartBtn = document.getElementById('fireworks-autopilot-start');
  const autopilotStopBtn = document.getElementById('fireworks-autopilot-stop');
  const captureStartBtn = document.getElementById('fireworks-capture-start');
  const captureStopBtn = document.getElementById('fireworks-capture-stop');
  const gradedLoadBtn = document.getElementById('fireworks-graded-load');
  const gradedStartBtn = document.getElementById('fireworks-graded-start');
  const gradedStopBtn = document.getElementById('fireworks-graded-stop');

  if (autopilotStartBtn) {
    autopilotStartBtn.addEventListener('click', () => {
      const scoreInput = document.getElementById('fireworks-autopilot-score');
      if (!scoreInput) {
        return;
      }
      let scoreStr = String(scoreInput.value || '').trim();
      if (scoreStr === '') {
        scoreStr = '1';
      }
      if (!/^[0-9]$/.test(scoreStr)) {
        alert('Please enter a single digit between 0 and 9 for the rubric option.');
        return;
      }

      if (!isGradescopeGradingPage()) {
        alert('Gradescope autopilot only works on a Gradescope grading page (question/submission view).');
        return;
      }

      const confirmed = window.confirm(
        'Fireworks autopilot will repeatedly apply rubric option "' +
        scoreStr +
        '" and press Gradescope\'s "Next ungraded" (keyboard shortcut "z") until you stop it.\n\n' +
        'Make sure you really want to assign this same option to all remaining ungraded submissions for this question.'
      );
      if (!confirmed) {
        return;
      }

      startGradescopeAutopilot(scoreStr);
    });
  }

  if (autopilotStopBtn) {
    autopilotStopBtn.addEventListener('click', () => {
      stopGradescopeAutopilot('Stopped by user.');
    });
  }

  if (captureStartBtn) {
    captureStartBtn.addEventListener('click', () => {
      startGradescopeResponseCaptureAutopilot();
    });
  }

  if (captureStopBtn) {
    captureStopBtn.addEventListener('click', () => {
      stopGradescopeResponseCaptureAutopilot('Capture stopped by user.');
    });
  }

  if (gradedLoadBtn) {
    gradedLoadBtn.addEventListener('click', () => {
      openGradedJsonFilePicker();
    });
  }

  if (gradedStartBtn) {
    gradedStartBtn.addEventListener('click', () => {
      // Close settings overlay so Gradescope hotkeys are not blocked by modal focus.
      if (panel) {
        panel.style.display = 'none';
      }
      startGradedJsonShortcutAutopilot();
    });
  }

  if (gradedStopBtn) {
    gradedStopBtn.addEventListener('click', () => {
      stopGradedJsonShortcutAutopilot('Graded JSON auto-apply stopped by user.');
    });
  }

  updateGradedJsonStatusLabel();
}

function showSettingsPanel() {
  console.log('🎆 Fireworks: showSettingsPanel called');
  let panel = document.getElementById('fireworks-settings-panel-page');
  
  if (!panel) {
    // Panel not created yet, create it
    console.log('🎆 Fireworks: Panel not found, creating it');
    setupSettingsPanel();
    // Wait a bit for async creation, then show
    setTimeout(() => {
      panel = document.getElementById('fireworks-settings-panel-page');
      if (panel) {
        panel.style.display = 'flex';
        // Reload saved value to ensure it's current
        const browserAPI = BROWSER === 'chrome' ? chrome : browser;
        const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
        storageAPI.get(['fireworksConnections', 'fireworksSearchText', 'fireworksKeywordCellOffset'], (result) => {
          if (!browserAPI.runtime.lastError) {
            const connectionsInput = document.getElementById('fireworks-connections-input-page');
            const searchTextInput = document.getElementById('fireworks-search-text-input-page');
            const offsetInput = document.getElementById('fireworks-keyword-offset-input-page');
            if (connectionsInput && result && result.fireworksConnections) {
              connectionsInput.value = result.fireworksConnections;
            }
            if (searchTextInput && result && result.fireworksSearchText) {
              searchTextInput.value = result.fireworksSearchText;
            }
            if (offsetInput) {
              offsetInput.value = normalizeKeywordCellOffset(result && result.fireworksKeywordCellOffset);
            }
          }
        });
      }
    }, 100);
    return;
  }
  
  panel.style.display = 'flex';
  // Reload saved values to ensure they're current
  const browserAPI = BROWSER === 'chrome' ? chrome : browser;
  const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
  storageAPI.get(['fireworksConnections', 'fireworksSearchText', 'fireworksKeywordCellOffset'], (result) => {
    if (!browserAPI.runtime.lastError) {
      const connectionsInput = document.getElementById('fireworks-connections-input-page');
      const searchTextInput = document.getElementById('fireworks-search-text-input-page');
      const offsetInput = document.getElementById('fireworks-keyword-offset-input-page');
      if (connectionsInput && result && result.fireworksConnections) {
        connectionsInput.value = result.fireworksConnections;
      }
      if (searchTextInput && result && result.fireworksSearchText) {
        searchTextInput.value = result.fireworksSearchText;
      }
      if (offsetInput) {
        offsetInput.value = normalizeKeywordCellOffset(result && result.fireworksKeywordCellOffset);
      }
    }
  });
}

// ================================
// Gradescope auto-grading helpers
// ================================

// Detect if we're on a Gradescope grading page where shortcuts make sense
function isGradescopeGradingPage() {
  const host = window.location.hostname || '';
  const path = window.location.pathname || '';

  if (!/gradescope\.com$/.test(host) && !/\.gradescope\.com$/.test(host)) {
    return false;
  }

  // Heuristic: question grading URLs usually contain "/questions/" or "/submissions/"
  if (path.includes('/questions/') || path.includes('/submissions/')) {
    return true;
  }

  // Fallback: look for a Next Ungraded button in the DOM
  const nextBtn = findNextUngradedButton();
  return !!nextBtn;
}

// Detect if we're on a Gradescope exam grading page (URL contains /grade)
function isGradescopeExamGradingPage() {
  const host = window.location.hostname || '';
  const path = window.location.pathname || '';
  const fullUrl = window.location.href || '';

  console.log("🎆 Fireworks: Checking exam grading page - host:", host, "path:", path);

  if (!/gradescope\.com$/.test(host) && !/\.gradescope\.com$/.test(host)) {
    console.log("🎆 Fireworks: Not a Gradescope domain");
    return false;
  }

  // Check if URL contains /grade (exam grading page)
  // Also check the full URL in case path doesn't include it
  const hasGrade = path.includes('/grade') || fullUrl.includes('/grade');
  const hasQuestionsOrSubmissions = path.includes('/questions/') || path.includes('/submissions/');
  
  console.log("🎆 Fireworks: hasGrade:", hasGrade, "hasQuestionsOrSubmissions:", hasQuestionsOrSubmissions);
  
  if (hasGrade && hasQuestionsOrSubmissions) {
    console.log("🎆 Fireworks: Detected exam grading page!");
    return true;
  }

  console.log("🎆 Fireworks: Not an exam grading page");
  return false;
}

// Extract student's answer from text boxes on the page - returns all candidates
function extractStudentAnswers() {
  console.log("🎆 Fireworks: Extracting student answers...");
  
  // Try multiple selectors to find the student's answer text box
  // Gradescope typically uses contenteditable divs or textareas for student responses
  const selectors = [
    // Specific Gradescope patterns
    'div[contenteditable="true"][data-placeholder*="answer"]',
    'div[contenteditable="true"][data-placeholder*="Answer"]',
    'div[contenteditable="true"][data-placeholder*="response"]',
    'div[contenteditable="true"][data-placeholder*="Response"]',
    'textarea[aria-label*="answer"]',
    'textarea[aria-label*="Answer"]',
    'textarea[aria-label*="response"]',
    'textarea[aria-label*="Response"]',
    'textarea[placeholder*="answer"]',
    'textarea[placeholder*="Answer"]',
    // Class-based selectors
    'textarea[class*="answer"]',
    'textarea[class*="response"]',
    'textarea[class*="submission"]',
    'div[contenteditable="true"][class*="answer"]',
    'div[contenteditable="true"][class*="response"]',
    'div[contenteditable="true"][class*="submission"]',
    // ID-based selectors
    'textarea[id*="answer"]',
    'textarea[id*="response"]',
    'textarea[id*="submission"]',
    'div[contenteditable="true"][id*="answer"]',
    'div[contenteditable="true"][id*="response"]',
    // Generic contenteditable (but check content)
    'div[contenteditable="true"]',
    // Generic textareas (but check content)
    'textarea'
  ];

  const candidates = [];

  for (const sel of selectors) {
    const elements = document.querySelectorAll(sel);
    console.log(`🎆 Fireworks: Checking selector "${sel}": found ${elements.length} elements`);
    
    for (const el of elements) {
      // Skip if it's a rubric input, score input, or comment field
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
      const dataPlaceholder = (el.getAttribute('data-placeholder') || '').toLowerCase();
      const id = (el.id || '').toLowerCase();
      const className = (el.className || '').toLowerCase();
      const name = (el.getAttribute('name') || '').toLowerCase();
      
      // Skip grading-related fields
      if (ariaLabel.includes('score') || ariaLabel.includes('rubric') || ariaLabel.includes('comment') ||
          placeholder.includes('score') || placeholder.includes('rubric') || placeholder.includes('comment') ||
          dataPlaceholder.includes('score') || dataPlaceholder.includes('rubric') || dataPlaceholder.includes('comment') ||
          id.includes('score') || id.includes('rubric') || id.includes('comment') ||
          className.includes('score') || className.includes('rubric') || className.includes('comment') ||
          name.includes('score') || name.includes('rubric') || name.includes('comment')) {
        console.log(`🎆 Fireworks: Skipping element (grading-related):`, { ariaLabel, placeholder, id, className });
        continue;
      }

      // Get text content
      let text = '';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        text = el.value || '';
      } else if (el.isContentEditable || el.contentEditable === 'true') {
        text = el.innerText || el.textContent || '';
      } else {
        text = el.innerText || el.textContent || '';
      }

      const trimmedText = text.trim();
      
      // Score this candidate based on various factors
      let score = 0;
      
      // Must have substantial text
      if (trimmedText.length < 10) {
        continue;
      }
      
      score += Math.min(trimmedText.length / 100, 10); // Longer text is better (up to 10 points)
      
      // Bonus for specific keywords that indicate student answers
      const answerKeywords = ['because', 'explain', 'example', 'reason', 'therefore', 'thus', 'however'];
      const lowerText = trimmedText.toLowerCase();
      answerKeywords.forEach(keyword => {
        if (lowerText.includes(keyword)) {
          score += 2;
        }
      });
      
      // Bonus if it's in a contenteditable div (common for Gradescope)
      if (el.isContentEditable || el.contentEditable === 'true') {
        score += 5;
      }
      
      // Penalty if it looks like a question or rubric
      if (lowerText.includes('points') && lowerText.includes('criteria')) {
        score -= 20; // Likely a rubric
      }
      if (lowerText.startsWith('question') || lowerText.startsWith('q:')) {
        score -= 10; // Likely a question
      }
      
      console.log(`🎆 Fireworks: Candidate element score: ${score.toFixed(1)}, text preview: "${trimmedText.substring(0, 50)}..."`);
      
      if (score > 5) {
        candidates.push({
          text: trimmedText,
          score: score,
          element: el,
          preview: trimmedText.substring(0, 100) + (trimmedText.length > 100 ? '...' : '')
        });
      }
    }
  }
  
  // Strategy 1: Look for text that appears between "Grading comment:" markers
  // This is a common pattern in Gradescope where answers appear between grading comment sections
  console.log("🎆 Fireworks: Trying to find answer between grading comments...");
  const allText = document.body.innerText || document.body.textContent || '';
  const gradingCommentMatches = allText.match(/Grading comment:[\s\S]*?Grading comment:/gi);
  
  if (gradingCommentMatches && gradingCommentMatches.length > 0) {
    // Extract text between grading comments
    const parts = allText.split(/Grading comment:/gi);
    for (let i = 1; i < parts.length; i++) {
      const part = parts[i].trim();
      // Skip if it's too short or looks like a question/rubric
      if (part.length < 30) continue;
      const lower = part.toLowerCase();
      if (lower.includes('points') && lower.includes('criteria')) continue;
      if (lower.includes('rubric')) continue;
      if (lower.startsWith('question') || lower.startsWith('q:')) continue;
      
      // Extract substantial paragraphs
      const paragraphs = part.split('\n').map(p => p.trim()).filter(p => p.length > 20);
      const answerParagraphs = paragraphs.filter(p => {
        const pl = p.toLowerCase();
        return !pl.includes('points') && 
               !pl.includes('criteria') &&
               !pl.includes('rubric') &&
               !pl.match(/^\d+\./) &&
               p.length > 30;
      });
      
      if (answerParagraphs.length > 0) {
        const answerText = answerParagraphs.join('\n\n');
        console.log(`🎆 Fireworks: Found answer between grading comments (${answerText.length} chars)`);
        candidates.push({
          text: answerText,
          score: 9,
          element: document.body,
          preview: answerText.substring(0, 100) + (answerText.length > 100 ? '...' : '')
        });
      }
    }
  }
  
  // Sort candidates by score (highest first)
  candidates.sort((a, b) => b.score - a.score);
  
  console.log(`🎆 Fireworks: Found ${candidates.length} candidate answers`);
  return candidates;
}

function findScoreInput() {
  // Try several selectors that commonly match Gradescope's score input
  const selectors = [
    'input[aria-label="Score"]',
    'input[aria-label*="Score"]',
    'input[name="score"]',
    'input[type="number"][class*="score"]',
    'input[type="number"][data-testid*="score"]',
    'input[type="number"]'
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function findNextUngradedButton() {
  // Prefer explicit data-testid/aria labels if present
  const explicitSelectors = [
    '[data-testid="next-ungraded"]',
    'button[aria-label*="Next Ungraded"]',
    'button[aria-label*="next ungraded"]'
  ];

  for (const sel of explicitSelectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }

  // Fallback: search all buttons for visible text
  const candidates = Array.from(document.querySelectorAll('button, a[role="button"]'));
  return candidates.find(btn => {
    const text = (btn.innerText || btn.textContent || '').trim().toLowerCase();
    return text.includes('next ungraded');
  }) || null;
}

// Set numeric score directly and then go to "Next ungraded"
function setScoreAndAdvance(scoreDigit) {
  const key = String(scoreDigit);

  // Find the main score input Gradescope uses for this question
  const input = findScoreInput();
  if (!input) {
    console.warn('🎆 Fireworks: Could not find score input for auto-grading.');
    return false;
  }

  // Set the value in a way React/Vue-style frameworks will notice
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, key);
  } else {
    input.value = key;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const nextBtn = findNextUngradedButton();
  if (!nextBtn) {
    console.warn('🎆 Fireworks: Next Ungraded button not found after setting score.');
    return false;
  }

  // Give the UI a brief moment to record the score, then click "Next ungraded"
  setTimeout(() => {
    nextBtn.click();
  }, 150);

  return true;
}

// ================================
// Gradescope autopilot grading
// ================================

let fireworksAutopilotRunning = false;
let fireworksAutopilotIteration = 0;
let fireworksResponseCaptureRunning = false;
let fireworksCapturedResponses = [];
let fireworksGradedJsonAutopilotRunning = false;
let fireworksLoadedGradedRecords = [];
let fireworksLoadedGradedRecordMap = {};

// Global flag to request stopping GPT auto-grading from outside the viewer
let fireworksGptAutoStopRequested = false;

function blurAutopilotFocus() {
  const active = document.activeElement;
  if (
    active &&
    (active.tagName === 'INPUT' ||
     active.tagName === 'TEXTAREA' ||
     active.tagName === 'SELECT' ||
     active.tagName === 'BUTTON' ||
     active.isContentEditable)
  ) {
    try {
      active.blur();
    } catch (e) {
      // ignore
    }
  }

  // Try to focus the main document body so global key handlers fire
  if (document.body && typeof document.body.focus === 'function') {
    try {
      document.body.focus();
    } catch (e) {
      // ignore
    }
  }
}

function setAutopilotStatus(message) {
  const statusEl = document.getElementById('fireworks-autopilot-status');
  if (statusEl) {
    statusEl.textContent = 'Autopilot status: ' + message;
  }
}

function updateGradedJsonStatusLabel(text) {
  const statusEl = document.getElementById('fireworks-graded-json-status');
  if (!statusEl) return;
  if (typeof text === 'string' && text.trim()) {
    statusEl.textContent = text;
    return;
  }
  const loadedCount = Array.isArray(fireworksLoadedGradedRecords) ? fireworksLoadedGradedRecords.length : 0;
  statusEl.textContent = loadedCount > 0
    ? `Graded JSON: Loaded ${loadedCount} records.`
    : 'Graded JSON: Not loaded.';
}

function normalizeLoadedGradedRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const current = parseInt(String(raw.current ?? ''), 10);
  if (!Number.isFinite(current)) return null;
  const totalRaw = parseInt(String(raw.total ?? ''), 10);
  const total = Number.isFinite(totalRaw) ? totalRaw : null;
  const llm = raw.llmGrading && typeof raw.llmGrading === 'object' ? raw.llmGrading : {};
  const shortcutRaw = llm.shortcut ?? raw.shortcut ?? '';
  const shortcut = String(shortcutRaw || '').trim();
  return {
    current,
    total,
    studentResponse: String(raw.studentResponse || ''),
    llmGrading: {
      points: llm.points ?? null,
      shortcut: shortcut,
      feedback: String(llm.feedback || raw.feedback || '')
    }
  };
}

function setLoadedGradedRecords(records) {
  const normalized = (Array.isArray(records) ? records : [])
    .map(normalizeLoadedGradedRecord)
    .filter(Boolean)
    .sort((a, b) => a.current - b.current);

  fireworksLoadedGradedRecords = normalized;
  fireworksLoadedGradedRecordMap = {};
  normalized.forEach((row) => {
    fireworksLoadedGradedRecordMap[row.current] = row;
  });
  updateGradedJsonStatusLabel();
  reportLoadedGradedJsonQuality(normalized);
}

function reportLoadedGradedJsonQuality(records) {
  if (!Array.isArray(records) || records.length < 2) {
    return;
  }

  let longestRun = 1;
  let currentRun = 1;
  let runStart = 0;
  let longestRunStart = 0;
  let longestRunEnd = 0;

  for (let i = 1; i < records.length; i += 1) {
    const prev = records[i - 1];
    const curr = records[i];
    const sameShortcut = String(prev?.llmGrading?.shortcut || '') === String(curr?.llmGrading?.shortcut || '');
    const sameResponse = String(prev?.studentResponse || '').trim() === String(curr?.studentResponse || '').trim();
    if (sameShortcut && sameResponse) {
      currentRun += 1;
      if (currentRun > longestRun) {
        longestRun = currentRun;
        longestRunStart = runStart;
        longestRunEnd = i;
      }
    } else {
      currentRun = 1;
      runStart = i;
    }
  }

  if (longestRun >= 5) {
    const startRec = records[longestRunStart];
    const endRec = records[longestRunEnd];
    const warning = {
      repeatedRunLength: longestRun,
      startCurrent: startRec?.current,
      endCurrent: endRec?.current,
      shortcut: startRec?.llmGrading?.shortcut || '',
      responsePreview: String(startRec?.studentResponse || '').slice(0, 140)
    };
    console.warn('🎆 Fireworks: Loaded graded JSON appears to contain repeated consecutive rows.', warning);
    updateGradedJsonStatusLabel(
      `Graded JSON loaded with warning: repeated rows from ${warning.startCurrent} to ${warning.endCurrent} (len ${warning.repeatedRunLength}).`
    );
  }
}

function openGradedJsonFilePicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        alert('Loaded JSON must be an array of graded records.');
        return;
      }
      setLoadedGradedRecords(parsed);
      updateGradedJsonStatusLabel(`Graded JSON: Loaded ${fireworksLoadedGradedRecords.length} records from ${file.name}.`);
      setAutopilotStatus('Loaded graded JSON. Ready to auto-apply shortcuts.');
      debugCurrentSubmissionGradingFromLoadedJson();
    } catch (e) {
      console.error('🎆 Fireworks: Failed to load graded JSON:', e);
      alert('Failed to load graded JSON file. Please verify JSON format.');
    } finally {
      input.remove();
    }
  });
  document.body.appendChild(input);
  input.click();
}

function getCurrentGradedSubmissionState() {
  const progress = getSubmissionProgressFromPage();
  const current = progress && Number.isFinite(progress.current) ? progress.current : null;
  const total = progress && Number.isFinite(progress.total) ? progress.total : null;
  const record = Number.isFinite(current) ? fireworksLoadedGradedRecordMap[current] : null;
  const shortcut = String(record?.llmGrading?.shortcut || '').trim();

  return {
    progress,
    current,
    total,
    record,
    shortcut
  };
}

function remapShortcutForGradescope(shortcut) {
  const s = String(shortcut || '').trim();
  const inverted = {
    '1': '3',
    '2': '2',
    '3': '1'
  };
  return inverted[s] || s;
}

function extractShortcutFromText(text) {
  const s = String(text || ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;

  // Common rubric labels like "2-2.0 Points" or "2: ..."
  let m = s.match(/(?:^|\s)([0-9])\s*[-:]/);
  if (m && m[1]) return m[1];

  // Fallback: "option 2", "shortcut 2", etc.
  m = s.match(/(?:option|shortcut|rubric)\s*([0-9])/i);
  if (m && m[1]) return m[1];

  return null;
}

function parseRubricShortcutPointMapFromPage() {
  const rows = Array.from(document.querySelectorAll('[class*="rubric"] li, [class*="rubric"] tr'));
  const mappings = [];
  rows.forEach((row) => {
    const text = String(row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const m = text.match(/(?:^|\s)([0-9])\s*-\s*([0-9]+(?:\.[0-9]+)?)\s*Points\b/i);
    if (!m) return;
    const shortcut = m[1];
    const points = parseFloat(m[2]);
    if (!Number.isFinite(points)) return;
    mappings.push({ shortcut, points, textPreview: text.slice(0, 180) });
  });
  return mappings;
}

function getCurrentScoreValueFromPage() {
  // Prefer the rendered "Total Points X/Y pts" text shown by Gradescope.
  const totalPointsText = String(document.body?.innerText || '');
  const pointsMatch = totalPointsText.match(/Total\s+Points[\s\S]{0,120}?([0-9]+(?:\.[0-9]+)?)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s*pts/i);
  if (pointsMatch && pointsMatch[1]) {
    const scored = parseFloat(pointsMatch[1]);
    if (Number.isFinite(scored)) {
      return scored;
    }
  }

  // Fallback to an explicit score input near grading UI (if available).
  const input = findScoreInput();
  if (!input) return null;
  const raw = String(input.value || '').trim();
  if (!raw) return null;
  const num = parseFloat(raw);
  return Number.isFinite(num) ? num : null;
}

function getCurrentPageGradedShortcut() {
  // Primary strategy: infer shortcut from current score value and rubric point mapping.
  const scoreValue = getCurrentScoreValueFromPage();
  const rubricMap = parseRubricShortcutPointMapFromPage();
  if (Number.isFinite(scoreValue) && rubricMap.length > 0) {
    const matched = rubricMap.find((m) => m.points === scoreValue);
    if (matched && matched.shortcut) {
      return matched.shortcut;
    }
  }

  // Secondary strategy: inspect explicit selected/active rubric state in DOM.
  const scopedSelectors = [
    // Preferred explicit state attributes
    '[class*="rubric"] [aria-checked="true"]',
    '[class*="rubric"] [aria-selected="true"]',
    '[class*="rubric"] [data-selected="true"]',
    '[class*="rubric"] input[type="radio"]:checked',
    // Common active/selected classes
    '[class*="rubric"] .selected',
    '[class*="rubric"] .active',
    '[class*="rubric"] [class*="selected"]',
    '[class*="rubric"] [class*="active"]'
  ];

  for (const sel of scopedSelectors) {
    const nodes = Array.from(document.querySelectorAll(sel));
    for (const node of nodes) {
      const text = (node.innerText || node.textContent || '').trim();
      const shortcut = extractShortcutFromText(text);
      if (shortcut) return shortcut;
      // For checked radios, inspect nearby rubric row/container text.
      if (node.matches && node.matches('input[type="radio"]')) {
        const container = node.closest('li, tr, div');
        const containerText = (container?.innerText || container?.textContent || '').trim();
        const containerShortcut = extractShortcutFromText(containerText);
        if (containerShortcut) return containerShortcut;
      }
    }
  }

  // Fallback: inspect likely rubric option containers and try to infer selected style.
  const rubricBlocks = Array.from(document.querySelectorAll('[class*="rubric"] li, [class*="rubric"] tr, [class*="rubric"] [role="option"], [class*="rubric"] div'));
  for (const block of rubricBlocks) {
    const style = window.getComputedStyle(block);
    const text = (block.innerText || block.textContent || '').trim();
    if (!text) continue;
    // Heuristic: selected items often have stronger background/border styles.
    const looksSelected =
      style.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
      style.borderLeftWidth !== '0px' ||
      block.getAttribute('aria-selected') === 'true' ||
      block.getAttribute('aria-checked') === 'true';
    if (!looksSelected) continue;
    const shortcut = extractShortcutFromText(text);
    if (shortcut) return shortcut;
  }

  return null;
}

function getRubricSelectionDebugState() {
  const selectors = [
    '[class*="rubric"] [aria-checked="true"]',
    '[class*="rubric"] [aria-selected="true"]',
    '[class*="rubric"] [data-selected="true"]',
    '[class*="rubric"] input[type="radio"]',
    '[class*="rubric"] [role="radio"]',
    '[class*="rubric"] [role="option"]',
    '[class*="rubric"] li',
    '[class*="rubric"] tr'
  ];

  const seen = new Set();
  const rows = [];

  selectors.forEach((sel) => {
    const nodes = Array.from(document.querySelectorAll(sel));
    nodes.forEach((node, idx) => {
      if (!node || seen.has(node)) return;
      seen.add(node);

      const text = String(node.innerText || node.textContent || '').trim().replace(/\s+/g, ' ');
      if (!text) return;

      const style = window.getComputedStyle(node);
      const row = {
        selector: sel,
        indexInSelector: idx,
        tag: node.tagName,
        id: node.id || null,
        className: typeof node.className === 'string' ? node.className : null,
        role: node.getAttribute ? node.getAttribute('role') : null,
        ariaChecked: node.getAttribute ? node.getAttribute('aria-checked') : null,
        ariaSelected: node.getAttribute ? node.getAttribute('aria-selected') : null,
        dataSelected: node.getAttribute ? node.getAttribute('data-selected') : null,
        checked: typeof node.checked === 'boolean' ? node.checked : null,
        inferredShortcut: extractShortcutFromText(text),
        textPreview: text.slice(0, 220),
        backgroundColor: style.backgroundColor,
        borderLeftWidth: style.borderLeftWidth,
        borderLeftColor: style.borderLeftColor
      };
      rows.push(row);
    });
  });

  return {
    currentScoreValue: getCurrentScoreValueFromPage(),
    rubricShortcutPointMap: parseRubricShortcutPointMapFromPage(),
    rubricNodes: rows
  };
}

function debugCurrentSubmissionGradingFromLoadedJson() {
  const state = getCurrentGradedSubmissionState();
  const { current, total, record, shortcut } = state;
  const pageShortcut = getCurrentPageGradedShortcut();
  const rubricState = getRubricSelectionDebugState();

  if (!Number.isFinite(current)) {
    console.debug('🎆 Fireworks: Current graded record lookup failed - could not detect page submission index.');
    return;
  }

  if (!record) {
    console.debug('🎆 Fireworks: Current graded record not found in loaded JSON.', {
      current,
      total,
      pageShortcut,
      rubricState
    });
    return;
  }

  console.debug('🎆 Fireworks: Current graded record for this submission', {
    current,
    total,
    shortcutFromJson: shortcut,
    shortcutAppliedToPage: remapShortcutForGradescope(shortcut),
    pageShortcut: pageShortcut,
    shortcutFromPage: pageShortcut,
    studentResponse: record.studentResponse,
    llmGrading: record.llmGrading,
    rubricState
  });
}

function stopGradedJsonShortcutAutopilot(reason) {
  fireworksGradedJsonAutopilotRunning = false;
  if (reason) {
    setAutopilotStatus(reason);
  }
}

function startGradedJsonShortcutAutopilot() {
  if (!isGradescopeGradingPage()) {
    alert('Graded JSON auto-apply only works on a Gradescope grading page.');
    return;
  }
  if (!Array.isArray(fireworksLoadedGradedRecords) || fireworksLoadedGradedRecords.length === 0) {
    alert('Please load a graded JSON file first.');
    return;
  }
  if (fireworksGradedJsonAutopilotRunning) {
    setAutopilotStatus('Graded JSON auto-apply is already running.');
    return;
  }

  fireworksGradedJsonAutopilotRunning = true;
  setAutopilotStatus('Running graded JSON auto-apply...');
  debugCurrentSubmissionGradingFromLoadedJson();

  const step = () => {
    if (!fireworksGradedJsonAutopilotRunning) return;
    if (!isGradescopeGradingPage()) {
      stopGradedJsonShortcutAutopilot('Stopped graded auto-apply: left grading page.');
      return;
    }

    const state = getCurrentGradedSubmissionState();
    const { current, total, record, shortcut: shortcutFromJson } = state;

    if (!Number.isFinite(current)) {
      stopGradedJsonShortcutAutopilot('Stopped graded auto-apply: cannot detect current submission.');
      return;
    }

    if (!record) {
      stopGradedJsonShortcutAutopilot(`Stopped graded auto-apply: no graded entry for submission ${current}.`);
      return;
    }

    // Safety check requested by user: make sure order/count matches current page.
    if (Number.isFinite(total) && Number.isFinite(record.total) && record.total !== total) {
      stopGradedJsonShortcutAutopilot(
        `Stopped graded auto-apply: total mismatch (page ${total}, file ${record.total}) at submission ${current}.`
      );
      alert(
        `Graded JSON mismatch at submission ${current}: page total is ${total}, but file total is ${record.total}. Auto-apply stopped.`
      );
      return;
    }

    const shortcut = remapShortcutForGradescope(shortcutFromJson);
    if (!/^[0-9a-zA-Z]$/.test(shortcut)) {
      stopGradedJsonShortcutAutopilot(`Stopped graded auto-apply: invalid shortcut for submission ${current}.`);
      return;
    }

    setAutopilotStatus(
      `Applying graded shortcut "${shortcut}" (from JSON "${shortcutFromJson}") for submission ${current}${Number.isFinite(total) ? ` of ${total}` : ''}.`
    );
    updateGradedJsonStatusLabel(
      `Graded JSON: submission ${current}${Number.isFinite(total) ? ` of ${total}` : ''} -> JSON "${shortcutFromJson}" => applied "${shortcut}", points ${record?.llmGrading?.points ?? 'N/A'}.`
    );

    // Ensure page-level shortcut listeners can receive the key.
    blurAutopilotFocus();
    if (document.body && typeof document.body.click === 'function') {
      try {
        document.body.click();
      } catch (e) {
        // ignore
      }
    }
    console.debug('🎆 Fireworks: Applying current graded shortcut', {
      current,
      total,
      shortcutFromJson,
      appliedShortcut: shortcut
    });
    simulateKeyPress(shortcut);

    const done = Number.isFinite(total) && current >= total;
    if (done) {
      stopGradedJsonShortcutAutopilot('Graded JSON auto-apply complete.');
      return;
    }

    setTimeout(() => {
      if (!fireworksGradedJsonAutopilotRunning) return;
      const nextBtn = findNextUngradedButton();
      if (nextBtn) {
        nextBtn.click();
      } else {
        simulateKeyPress('z');
      }
      setTimeout(step, 1100);
    }, 220);
  };

  step();
}

function simulateKeyPress(key) {
  // Derive keyCode/which for common single-character keys (digits, letters)
  const upper = key.length === 1 ? key.toUpperCase() : key;
  const keyCode =
    upper.length === 1 ? upper.charCodeAt(0) : 0;

  const eventInit = {
    key,
    code: /^[0-9]$/.test(key) ? ('Digit' + key) : ('Key' + upper),
    keyCode,
    which: keyCode,
    charCode: keyCode,
    bubbles: true,
    cancelable: true
  };

  // Dispatch on several targets so Gradescope's listeners can catch it
  const targets = [document.activeElement, document.body, document, window];
  ['keydown', 'keypress', 'keyup'].forEach((type) => {
    targets.forEach((target) => {
      if (target && typeof target.dispatchEvent === 'function') {
        const evt = new KeyboardEvent(type, eventInit);
        // Some code checks deprecated keyCode/which properties; force them if possible
        try {
          Object.defineProperty(evt, 'keyCode', { get: () => keyCode });
          Object.defineProperty(evt, 'which', { get: () => keyCode });
          Object.defineProperty(evt, 'charCode', { get: () => keyCode });
        } catch (e) {
          // Ignore if we can't override (not critical in modern browsers)
        }
        target.dispatchEvent(evt);
      }
    });
  });
}

function stopGradescopeAutopilot(reason) {
  if (!fireworksAutopilotRunning) {
    if (reason) {
      setAutopilotStatus(reason);
    }
    return;
  }

  fireworksAutopilotRunning = false;
  if (reason) {
    setAutopilotStatus(reason);
  } else {
    setAutopilotStatus('Stopped.');
  }
}

function downloadCapturedResponsesJson(records) {
  const safeRecords = Array.isArray(records) ? records : [];
  const fileName = `fireworks-student-responses-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const blob = new Blob([JSON.stringify(safeRecords, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stopGradescopeResponseCaptureAutopilot(reason, askToSave = true) {
  const wasRunning = fireworksResponseCaptureRunning;
  fireworksResponseCaptureRunning = false;
  setAutopilotStatus(reason || 'Response capture stopped.');

  if (!wasRunning || !askToSave) return;

  if (fireworksCapturedResponses.length === 0) {
    alert('No student responses were captured.');
    return;
  }

  const shouldSave = window.confirm(
    `Captured ${fireworksCapturedResponses.length} student responses. Save JSON locally now?`
  );
  if (shouldSave) {
    downloadCapturedResponsesJson(fireworksCapturedResponses);
  }
}

function startGradescopeResponseCaptureAutopilot() {
  if (!isGradescopeGradingPage()) {
    alert('Response capture only works on a Gradescope grading page (question/submission view).');
    return;
  }

  if (fireworksResponseCaptureRunning) {
    setAutopilotStatus('Response capture is already running.');
    return;
  }

  fireworksResponseCaptureRunning = true;
  fireworksCapturedResponses = [];
  let lastSubmission = null;
  let staleCount = 0;
  let iteration = 0;
  const maxIterations = 2000;

  setAutopilotStatus('Capturing responses...');

  const step = async () => {
    if (!fireworksResponseCaptureRunning) {
      return;
    }

    if (!isGradescopeGradingPage()) {
      stopGradescopeResponseCaptureAutopilot('Capture stopped: left grading page.');
      return;
    }

    if (iteration >= maxIterations) {
      stopGradescopeResponseCaptureAutopilot('Capture stopped: safety limit reached.');
      return;
    }
    iteration += 1;

    const progress = getSubmissionProgressFromPage();
    const current = progress && Number.isFinite(progress.current) ? progress.current : null;
    const total = progress && Number.isFinite(progress.total) ? progress.total : null;

    let studentResponse = '';

    // Primary path: silently fetch current student's notebook and extract target cell by keyword/offset.
    try {
      studentResponse = await extractStudentResponseFromNotebookBySettings();
    } catch (e) {
      // keep fallback paths below
    }

    // Prefer the user-confirmed answer box selector if available.
    if (!studentResponse) {
      const savedSelector = localStorage.getItem('fireworks-saved-answer-selector');
      const savedSelectorIndex = parseInt(localStorage.getItem('fireworks-saved-answer-selector-index') || '0', 10) || 0;
      if (savedSelector) {
        const savedEl = pickElementBySelectorAndIndex(savedSelector, savedSelectorIndex);
        if (savedEl) {
          studentResponse = String(extractTextFromElement(savedEl) || '').trim();
        }
      }
    }

    // Fallback to heuristic extraction only if saved selector path failed.
    if (!studentResponse) {
      const extracted = extractStudentAnswers();
      const filtered = (Array.isArray(extracted) ? extracted : []).filter((candidate) => {
        const t = String(candidate?.text || '').trim().toLowerCase();
        if (!t) return false;
        // Avoid capturing grader/rubric text as student response.
        if (t.includes('grading comment')) return false;
        if (t.includes('rubric settings')) return false;
        if (t.includes('point adjustment')) return false;
        return true;
      });
      studentResponse = filtered.length > 0 ? String(filtered[0].text || '').trim() : '';
    }

    if (current !== null) {
      const record = {
        current: current,
        total: total,
        studentResponse: studentResponse,
        capturedAt: new Date().toISOString()
      };
      const idx = fireworksCapturedResponses.findIndex((item) => item.current === current);
      if (idx >= 0) {
        fireworksCapturedResponses[idx] = record;
      } else {
        fireworksCapturedResponses.push(record);
      }
    }

    setAutopilotStatus(
      `Capturing responses... ${current !== null ? `submission ${current}` : ''}${total !== null ? ` of ${total}` : ''} (saved ${fireworksCapturedResponses.length})`
    );

    if (current !== null && total !== null && current >= total) {
      stopGradescopeResponseCaptureAutopilot('Capture complete.');
      return;
    }

    if (current !== null && current === lastSubmission) {
      staleCount += 1;
    } else {
      staleCount = 0;
    }
    lastSubmission = current;

    if (staleCount >= 3) {
      stopGradescopeResponseCaptureAutopilot('Capture stopped: unable to advance to next submission.');
      return;
    }

    const nextBtn = findNextUngradedButton();
    if (nextBtn) {
      nextBtn.click();
    } else {
      simulateKeyPress('z');
    }

    setTimeout(() => {
      Promise.resolve(step()).catch(() => {});
    }, 1300);
  };

  Promise.resolve(step()).catch((err) => {
    console.error('🎆 Fireworks: response capture loop crashed:', err);
    stopGradescopeResponseCaptureAutopilot('Capture stopped: unexpected error.');
  });
}

function startGradescopeAutopilot(scoreDigit) {
  const key = String(scoreDigit);
  if (!/^[0-9]$/.test(key)) {
    alert('Autopilot requires a single digit between 0 and 9.');
    return;
  }

  if (!isGradescopeGradingPage()) {
    alert('Gradescope autopilot only works on a Gradescope grading page (question/submission view).');
    return;
  }

  fireworksAutopilotRunning = true;
  fireworksAutopilotIteration = 0;
  setAutopilotStatus('Running with rubric option ' + key + '...');

  const maxIterations = 1000; // safety limit

  function step() {
    if (!fireworksAutopilotRunning) {
      return;
    }

    if (!isGradescopeGradingPage()) {
      stopGradescopeAutopilot('Stopped: left grading page.');
      alert('Fireworks autopilot stopped because you left the Gradescope grading page.');
      return;
    }

    if (fireworksAutopilotIteration >= maxIterations) {
      stopGradescopeAutopilot('Stopped after ' + maxIterations + ' submissions (safety limit).');
      alert('Fireworks autopilot reached its safety limit and stopped.');
      return;
    }

    fireworksAutopilotIteration += 1;

    // 1) Make sure focus is not inside an input/textarea/button so
    //    Gradescope's global keyboard shortcuts will fire
    blurAutopilotFocus();

    // 2) Apply rubric option with the chosen number key
    simulateKeyPress(key);

    // 3) After a short delay, press Gradescope's built-in "next ungraded" shortcut (z)
    setTimeout(() => {
      if (!fireworksAutopilotRunning) {
        return;
      }

      simulateKeyPress('z');

      // 4) Wait for navigation / UI update, then continue
      setTimeout(() => {
        if (!fireworksAutopilotRunning) {
          return;
        }
        step();
      }, 900);
    }, 180);
  }

  step();
}

// ================================
// Exam Grading with vLLM
// ================================

let examGradingViewerOpen = false;
let answerSelectionMode = false;
let highlightOverlay = null;

// Function to generate a unique selector for an element
function generateElementSelector(element) {
  if (!element) return null;
  
  // Prefer ID
  if (element.id) {
    return `#${element.id}`;
  }
  
  // Try data attributes
  const dataAttrs = Array.from(element.attributes).filter(attr => attr.name.startsWith('data-'));
  if (dataAttrs.length > 0) {
    return `${element.tagName.toLowerCase()}[${dataAttrs[0].name}="${dataAttrs[0].value}"]`;
  }
  
  // Try class names
  if (element.className && typeof element.className === 'string') {
    const classes = element.className.split(' ').filter(c => c.length > 0).slice(0, 2);
    if (classes.length > 0) {
      return `${element.tagName.toLowerCase()}.${classes.join('.')}`;
    }
  }
  
  // Fallback: use path
  const path = [];
  let current = element;
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      selector += `#${current.id}`;
      path.unshift(selector);
      break;
    }
    const siblings = Array.from(current.parentElement.children);
    const index = siblings.indexOf(current);
    selector += `:nth-child(${index + 1})`;
    path.unshift(selector);
    current = current.parentElement;
  }
  return path.join(' > ');
}

// Function to highlight an element
function highlightElement(element) {
  if (highlightOverlay) {
    highlightOverlay.remove();
  }
  
  if (!element) return;
  
  const rect = element.getBoundingClientRect();
  highlightOverlay = document.createElement('div');
  highlightOverlay.style.cssText = `
    position: fixed;
    top: ${rect.top + window.scrollY}px;
    left: ${rect.left + window.scrollX}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 4px solid #10b981;
    background: rgba(16, 185, 129, 0.1);
    pointer-events: none;
    z-index: 9998;
    box-shadow: 0 0 20px rgba(16, 185, 129, 0.5);
    transition: all 0.2s;
  `;
  document.body.appendChild(highlightOverlay);
}

// Function to remove highlight
function removeHighlight() {
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
}

// Function to extract text from an element
function extractTextFromElement(element) {
  if (!element) return '';
  
  if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
    return element.value || '';
  } else {
    return element.innerText || element.textContent || '';
  }
}

function logExtractedAnswerBox({ phase, selector, element, text }) {
  try {
    const el = element || null;
    const preview = String(text || '').trim().slice(0, 180);
    console.log('🎆 Fireworks: Answer box selected/extracted', {
      phase,
      selector: selector || null,
      tag: el ? el.tagName : null,
      id: el ? el.id : null,
      className: el ? (typeof el.className === 'string' ? el.className : '') : null,
      textLen: String(text || '').trim().length,
      preview: preview,
    });
  } catch (e) {
    // ignore logging failures
  }
}

function getElementIndexWithinSelector(selector, element) {
  if (!selector || !element) return 0;
  try {
    const matches = Array.from(document.querySelectorAll(selector));
    const idx = matches.indexOf(element);
    return idx >= 0 ? idx : 0;
  } catch (e) {
    return 0;
  }
}

function pickElementBySelectorAndIndex(selector, index) {
  if (!selector) return null;
  try {
    const matches = Array.from(document.querySelectorAll(selector));
    if (matches.length === 0) return null;
    const idx = typeof index === 'number' ? index : parseInt(index || '0', 10);
    return matches[Math.max(0, Math.min(matches.length - 1, Number.isFinite(idx) ? idx : 0))] || matches[0];
  } catch (e) {
    return null;
  }
}

// Ask user to click on text box before showing popup
function askUserToSelectTextBox() {
  return new Promise((resolve) => {
    // Check if we have a saved selector (+ index for non-unique selectors)
    const savedSelector = localStorage.getItem('fireworks-saved-answer-selector');
    const savedSelectorIndex = parseInt(localStorage.getItem('fireworks-saved-answer-selector-index') || '0', 10) || 0;
    // NOTE: Do NOT auto-apply the saved selector without prompting.
    // Gradescope can render multiple textareas (e.g. grading comments); user should confirm.
    
    // Show instruction overlay
    const instructionOverlay = document.createElement('div');
    instructionOverlay.id = 'fireworks-select-answer-overlay';
    instructionOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      z-index: 9998;
      cursor: crosshair;
      pointer-events: none; /* allow clicks to reach underlying page; box is separate */
    `;
    
    const instructionBox = document.createElement('div');
    instructionBox.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 30px;
      border-radius: 12px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
      pointer-events: auto; /* allow clicks on buttons */
      z-index: 10000;
    `;
    
    instructionBox.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #333;">📝 Select Student Answer Box</h3>
      <p style="margin: 0 0 20px 0; color: #666; font-size: 14px;">
        Click on the text box or element that contains the student's answer on this page.
      </p>
      <label style="display: flex; align-items: center; justify-content: center; gap: 8px; margin: 0 0 16px 0; font-size: 13px; color: #444;">
        <input id="fireworks-remember-selection" type="checkbox" checked>
        Remember this selection for next pages
      </label>
      <button id="fireworks-skip-selection" style="background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; margin-right: 10px;">
        Skip (Manual Input)
      </button>
      <button id="fireworks-use-saved" style="background: ${savedSelector ? '#10b981' : '#9ca3af'}; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: ${savedSelector ? 'pointer' : 'not-allowed'}; font-size: 14px;" ${savedSelector ? '' : 'disabled'}>
        Use Saved Selection
      </button>
      <div style="margin-top: 14px;">
        <button id="fireworks-clear-saved" style="background: transparent; color: #6b7280; border: 1px solid #d1d5db; padding: 6px 10px; border-radius: 6px; cursor: pointer; font-size: 12px;">
          Clear Saved Selection
        </button>
      </div>
    `;
    
    document.body.appendChild(instructionOverlay);
    document.body.appendChild(instructionBox);
    
    answerSelectionMode = true;
    
    const rememberCheckbox = instructionBox.querySelector('#fireworks-remember-selection');

    function isDisallowedAnswerElement(el) {
      if (!el) return true;
      const id = (el.id || '').toLowerCase();
      const className = (el.className || '').toLowerCase();
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();

      // Known grading/comment boxes to avoid
      if (id === 'adjustment-comment') return true;
      if (id.includes('comment') || ariaLabel.includes('comment') || placeholder.includes('comment')) return true;
      if (id.includes('rubric') || className.includes('rubric') || ariaLabel.includes('rubric')) return true;
      if (id.includes('score') || className.includes('score') || ariaLabel.includes('score')) return true;
      return false;
    }

    function cleanupAndResolve(payload) {
      document.removeEventListener('click', clickHandler, true);
      document.removeEventListener('mousemove', mouseMoveHandler);
      instructionOverlay.remove();
      instructionBox.remove();
      removeHighlight();
      answerSelectionMode = false;
      resolve(payload);
    }

    // Click handler for page elements
    const clickHandler = (e) => {
      // Let clicks on the instruction box/buttons behave normally
      if (instructionBox.contains(e.target)) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      // Find the best text-containing element
      let target = e.target;
      
      // Walk up the DOM tree to find a good text container
      while (target && target !== document.body) {
        const text = extractTextFromElement(target).trim();
        
        // Skip if it's the instruction overlay itself
        if (target.id === 'fireworks-select-answer-overlay' || target.closest('#fireworks-select-answer-overlay')) {
          return;
        }
        
        // Skip grading-related / disallowed elements
        if (isDisallowedAnswerElement(target)) {
          target = target.parentElement;
          continue;
        }
        
        // If this element has substantial text, use it
        if (text.length > 10) {
          const selector = generateElementSelector(target);
          const selectorIndex = getElementIndexWithinSelector(selector, target);
          
          // Save selector
          if (selector && rememberCheckbox?.checked) {
            localStorage.setItem('fireworks-saved-answer-selector', selector);
            localStorage.setItem('fireworks-saved-answer-selector-index', String(selectorIndex));
            console.log("🎆 Fireworks: Saved answer selector:", selector);
            console.log("🎆 Fireworks: Saved answer selector index:", selectorIndex);
          }
          
          logExtractedAnswerBox({
            phase: 'user_click_select',
            selector,
            element: target,
            text,
          });

          cleanupAndResolve({
            element: target,
            text: text,
            selector: selector,
            selectorIndex: selectorIndex
          });
          return;
        }
        
        target = target.parentElement;
      }
    };
    
    // Mouse move handler to highlight elements
    const mouseMoveHandler = (e) => {
      let target = e.target;
      while (target && target !== document.body) {
        const text = extractTextFromElement(target).trim();
        if (!isDisallowedAnswerElement(target) && text.length > 10) {
          highlightElement(target);
          break;
        }
        target = target.parentElement;
      }
    };
    
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('mousemove', mouseMoveHandler);
    
    // Skip button
    instructionBox.querySelector('#fireworks-skip-selection').addEventListener('click', () => {
      cleanupAndResolve({
        element: null,
        text: '',
        selector: null
      });
    });
    
    // Use saved button
    instructionBox.querySelector('#fireworks-use-saved').addEventListener('click', () => {
      if (savedSelector) {
        try {
          const element = pickElementBySelectorAndIndex(savedSelector, savedSelectorIndex);
          if (element) {
            const text = extractTextFromElement(element).trim();
            if (text.length > 0 && !isDisallowedAnswerElement(element)) {
              logExtractedAnswerBox({
                phase: 'use_saved_selector',
                selector: savedSelector,
                element,
                text,
              });
              cleanupAndResolve({
                element: element,
                text: text,
                selector: savedSelector,
                selectorIndex: savedSelectorIndex
              });
              return;
            }
          }
        } catch (e) {
          console.error('🎆 Fireworks: Error using saved selector:', e);
        }
      }
      alert('No saved selection found. Please click on a text box.');
    });

    // Clear saved selection
    instructionBox.querySelector('#fireworks-clear-saved').addEventListener('click', () => {
      localStorage.removeItem('fireworks-saved-answer-selector');
      localStorage.removeItem('fireworks-saved-answer-selector-index');
      alert('Saved selection cleared. Now click the student answer box on the page.');
      const useSavedBtn = instructionBox.querySelector('#fireworks-use-saved');
      if (useSavedBtn) {
        useSavedBtn.disabled = true;
        useSavedBtn.style.background = '#9ca3af';
        useSavedBtn.style.cursor = 'not-allowed';
      }
    });
  });
}

// Inject exam grading viewer
async function injectExamGradingViewer() {
  console.log("🎆 Fireworks: injectExamGradingViewer called");
  
  const existing = document.getElementById('fireworks-exam-grading-container');
  if (existing) {
    console.log("🎆 Fireworks: Exam grading viewer already exists, removing");
    existing.remove();
  }
  
  examGradingViewerOpen = true;
  
  // Ask user to select text box first
  const selectedAnswer = await askUserToSelectTextBox();
  
  // Build answer candidates
  let answerCandidates = [];
  if (selectedAnswer.element && selectedAnswer.text) {
    answerCandidates = [{
      text: selectedAnswer.text,
      score: 10,
      element: selectedAnswer.element,
      preview: selectedAnswer.text.substring(0, 150) + (selectedAnswer.text.length > 150 ? '...' : ''),
      selector: selectedAnswer.selector
    }];
  } else {
    // Fallback: try to extract answers
    const extracted = extractStudentAnswers();
    if (extracted && extracted.length > 0) {
      answerCandidates = extracted;
    } else {
      answerCandidates = [{
        text: '',
        score: 0,
        element: null,
        preview: 'No answer detected - please enter manually'
      }];
    }
  }
  
  showExamGradingViewer(answerCandidates);
}

// Show exam grading viewer (separated for reuse)
function showExamGradingViewer(answerCandidates) {
  
  // Default to the highest-scoring candidate
  let selectedAnswerIndex = 0;
  let selectedAnswer = answerCandidates[selectedAnswerIndex].text;

  // Lock the chosen answer box for this viewer session so "Grade Answer" doesn't re-detect.
  // Prefer the candidate selected during the hover/click step (passed in as answerCandidates[0]).
  let lockedAnswerSelector =
    (answerCandidates && answerCandidates[0] && answerCandidates[0].selector) ||
    localStorage.getItem('fireworks-saved-answer-selector') ||
    null;
  let lockedAnswerSelectorIndex =
    (answerCandidates && answerCandidates[0] && typeof answerCandidates[0].selectorIndex === 'number' && answerCandidates[0].selectorIndex) ||
    parseInt(localStorage.getItem('fireworks-saved-answer-selector-index') || '0', 10) ||
    0;
  let lockedAnswerElement =
    (answerCandidates && answerCandidates[0] && answerCandidates[0].element) ||
    (lockedAnswerSelector ? pickElementBySelectorAndIndex(lockedAnswerSelector, lockedAnswerSelectorIndex) : null);
  
  const container = document.createElement('div');
  container.id = 'fireworks-exam-grading-container';
  
  // Check if we need manual input
  const needsManualInput = answerCandidates.length === 1 && answerCandidates[0].text === '';
  
  // Build answer selection HTML if multiple candidates or manual input needed
  let answerSelectionHTML = '';
  if (answerCandidates.length > 1) {
    answerSelectionHTML = `
      <div class="fireworks-exam-section">
        <h4>Select Student Answer (${answerCandidates.length} found):</h4>
        <div id="fireworks-answer-candidates" style="max-height: 200px; overflow-y: auto; border: 1px solid #ccc; border-radius: 6px; padding: 10px;">
          ${answerCandidates.map((candidate, idx) => `
            <div style="margin-bottom: 10px; padding: 8px; border: 2px solid ${idx === 0 ? '#10b981' : '#e0e0e0'}; border-radius: 4px; cursor: pointer; background: ${idx === 0 ? '#f0fdf4' : '#fff'};" 
                 data-index="${idx}" class="fireworks-answer-candidate">
              <div style="display: flex; align-items: center; margin-bottom: 5px;">
                <input type="radio" name="answer-select" value="${idx}" ${idx === 0 ? 'checked' : ''}>
                <strong>Answer ${idx + 1}</strong> (Score: ${candidate.score.toFixed(1)})
              </div>
              <div style="font-size: 12px; color: #666; max-height: 60px; overflow: hidden;">
                ${escapeHtml(candidate.preview)}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  container.innerHTML = `
    <div class="fireworks-exam-grading-viewer">
      <div class="fireworks-exam-header">
        <h3>📝 Fireworks Exam Grading</h3>
        <div class="fireworks-exam-header-controls">
          <button id="fireworks-exam-reselect" class="fireworks-close" title="Re-select the student answer box for this page" style="margin-right: 8px;">🔁</button>
          <button id="fireworks-exam-close" class="fireworks-close">✕</button>
        </div>
      </div>
      <div class="fireworks-exam-content-wrapper">
        <div class="fireworks-exam-content" id="fireworks-exam-content">
          ${answerSelectionHTML}
          <div class="fireworks-exam-section">
            <h4>Question:</h4>
            <textarea id="fireworks-exam-question" class="fireworks-exam-rubric-input" placeholder="Paste or type the exam question here (optional)..." style="min-height: 80px; width: 100%; box-sizing: border-box;"></textarea>
          </div>
          <div class="fireworks-exam-section">
            <h4>Student Answer:</h4>
            ${needsManualInput ? `
              <textarea id="fireworks-exam-student-answer-manual" class="fireworks-exam-rubric-input" placeholder="Paste or type the student's answer here..." style="min-height: 150px;">${escapeHtml(selectedAnswer)}</textarea>
            ` : `
              <div id="fireworks-exam-student-answer" class="fireworks-exam-student-answer">${escapeHtml(selectedAnswer)}</div>
            `}
          </div>
          <div class="fireworks-exam-section">
            <h4>Rubric (Points | Criteria):</h4>
            <div id="fireworks-rubric-table-container">
              <table id="fireworks-rubric-table" style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
                <thead>
                  <tr style="background: #f5f5f5;">
                    <th style="padding: 8px; border: 1px solid #ccc; text-align: left; width: 120px;">Points</th>
                    <th style="padding: 8px; border: 1px solid #ccc; text-align: left;">Criteria</th>
                    <th style="padding: 8px; border: 1px solid #ccc; width: 60px;"></th>
                  </tr>
                </thead>
                <tbody id="fireworks-rubric-tbody">
                  <!-- Rubric rows will be loaded from localStorage or default -->
                </tbody>
              </table>
              <button id="fireworks-add-rubric-row" style="background: #10b981; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; margin-bottom: 10px;">+ Add Row</button>
            </div>
          </div>
          <div class="fireworks-exam-section">
            <h4>Rubric Keyboard Mapping (optional):</h4>
            <p style="font-size: 12px; color: #666; margin-bottom: 6px;">
              Map rubric point values to Gradescope number keys (0–9). If set, AI grading will press these keys instead of only typing the numeric score.
            </p>
            <div id="fireworks-key-mapping" style="border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px; max-height: 140px; overflow-y: auto; background: #f9fafb;"></div>
          </div>
          <div class="fireworks-exam-section">
            <h4>vLLM Configuration:</h4>
            <label style="display: flex; flex-direction: column; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 10px;">
              Model Name:
              <input type="text" id="fireworks-vllm-model" value="google/gemma-4-31B-it" placeholder="google/gemma-4-31B-it" style="width: 100%; margin-top: 5px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; box-sizing: border-box;">
            </label>
            <p style="font-size: 12px; color: #666; margin: 5px 0 10px 0;">
              <strong>⚠️ GPU Required:</strong> vLLM requires a GPU with sufficient VRAM. Estimated VRAM: <span id="fireworks-vram-estimate">~6GB</span>
            </p>
            <label style="display: flex; align-items: center; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 10px; cursor: pointer;">
              <input type="checkbox" id="fireworks-use-http" checked>
              Use HTTP API (vLLM server must be running):
              <input type="text" id="fireworks-vllm-url" value="http://localhost:8000/v1/chat/completions" style="width: 250px; margin-left: 10px; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
            </label>
            <label style="display: flex; align-items: center; font-size: 14px; color: #333; font-weight: 500; margin-bottom: 10px; cursor: pointer;">
              <input type="checkbox" id="fireworks-auto-advance" checked>
              Auto-advance to next page after grading (press 'z' to stop)
            </label>
            <div style="font-size: 12px; color: #444; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 8px 10px; margin-top: 4px;">
              <div style="font-weight: 600; margin-bottom: 4px;">Run vLLM locally (copy &amp; paste into terminal):</div>
              <pre style="margin: 0; font-size: 11px; background: #111827; color: #e5e7eb; padding: 8px; border-radius: 4px; overflow-x: auto;">
# Llama 3.2 3B
python -m vllm.entrypoints.openai.api_server \
  --host 127.0.0.1 \
  --port 8000 \
  --model meta-llama/Llama-3.2-3B-Instruct

# Gemma 4 31B
python -m vllm.entrypoints.openai.api_server \
  --host 127.0.0.1 \
  --port 8000 \
  --model google/gemma-4-31B-it \
  --enforce-eager \
  --max-model-len 32768

# Then keep URL as: http://127.0.0.1:8000/v1/chat/completions
              </pre>
            </div>
          </div>
          <div class="fireworks-exam-section">
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
              <button id="fireworks-exam-grade-btn" class="fireworks-exam-grade-btn">Grade Answer</button>
              <button id="fireworks-exam-next-btn" class="fireworks-exam-grade-btn" style="background: #4b5563;">
                Next submission (presses 'z')
              </button>
            </div>
            <div id="fireworks-exam-status" class="fireworks-exam-status"></div>
          </div>
          <div id="fireworks-exam-result" class="fireworks-exam-result" style="display: none;">
            <h4>Grading Result:</h4>
            <div id="fireworks-exam-result-content"></div>
            <div class="fireworks-exam-actions">
              <button id="fireworks-exam-apply-score" class="fireworks-exam-apply-btn">Apply Score</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(container);
  console.log("🎆 Fireworks: Exam grading container added to DOM");
  
  // Setup event handlers
  document.getElementById('fireworks-exam-close').addEventListener('click', () => {
    console.log("🎆 Fireworks: Exam grading close button clicked");
    container.remove();
    examGradingViewerOpen = false;
  });

  // Re-select answer box for current page (updates lock)
  const reselectBtn = container.querySelector('#fireworks-exam-reselect');
  if (reselectBtn) {
    reselectBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const picked = await askUserToSelectTextBox();
        if (picked && picked.element && picked.text) {
          lockedAnswerSelector = picked.selector || lockedAnswerSelector;
          if (typeof picked.selectorIndex === 'number') {
            lockedAnswerSelectorIndex = picked.selectorIndex;
          }
          lockedAnswerElement = picked.element;
          updateDisplayedAnswer(picked.text);
          const statusDiv = container.querySelector('#fireworks-exam-status');
          if (statusDiv) {
            statusDiv.textContent = 'Answer box re-selected for this page.';
            statusDiv.style.color = '#666';
          }
        }
      } catch (err) {
        console.error('🎆 Fireworks: reselect failed:', err);
      }
    });
  }
  
  container.addEventListener('click', (e) => {
    if (e.target === container) {
      console.log("🎆 Fireworks: Background clicked, closing exam grading viewer");
      container.remove();
      examGradingViewerOpen = false;
    }
  });

  // Make the exam grading viewer draggable by its header
  const viewerEl = container.querySelector('.fireworks-exam-grading-viewer');
  const headerEl = container.querySelector('.fireworks-exam-header');
  if (viewerEl && headerEl) {
    // Start in top-right so it doesn't block the answer area by default
    viewerEl.style.position = 'fixed';
    viewerEl.style.top = '40px';
    viewerEl.style.right = '40px';
    viewerEl.style.left = 'auto';
    viewerEl.style.margin = '0';

    let isDraggingViewer = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    const onMouseMove = (e) => {
      if (!isDraggingViewer) return;
      e.preventDefault();
      const newLeft = e.clientX - dragOffsetX;
      const newTop = e.clientY - dragOffsetY;
      viewerEl.style.left = `${newLeft}px`;
      viewerEl.style.top = `${newTop}px`;
      viewerEl.style.right = 'auto';
    };

    const onMouseUp = () => {
      if (!isDraggingViewer) return;
      isDraggingViewer = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    headerEl.addEventListener('mousedown', (e) => {
      // Don't start drag from close button
      const closeBtn = headerEl.querySelector('#fireworks-exam-close');
      if (closeBtn && closeBtn.contains(e.target)) {
        return;
      }
      e.preventDefault();
      const rect = viewerEl.getBoundingClientRect();
      isDraggingViewer = true;
      dragOffsetX = e.clientX - rect.left;
      dragOffsetY = e.clientY - rect.top;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }
  
  // Setup answer selection handlers
  if (answerCandidates.length > 1) {
    const candidates = container.querySelectorAll('.fireworks-answer-candidate');
    const answerDisplay = container.querySelector('#fireworks-exam-student-answer');
    const radios = container.querySelectorAll('input[name="answer-select"]');
    
    candidates.forEach((candidateEl, idx) => {
      candidateEl.addEventListener('click', () => {
        selectedAnswerIndex = idx;
        selectedAnswer = answerCandidates[idx].text;
        answerDisplay.textContent = selectedAnswer;

        // Also lock to the newly selected candidate if it has an element/selector
        lockedAnswerSelector = answerCandidates[idx].selector || lockedAnswerSelector;
        if (typeof answerCandidates[idx].selectorIndex === 'number') {
          lockedAnswerSelectorIndex = answerCandidates[idx].selectorIndex;
        }
        lockedAnswerElement = answerCandidates[idx].element || lockedAnswerElement;
        console.log('🎆 Fireworks: Locked answer box updated from candidate selection', {
          lockedAnswerSelector,
          lockedAnswerSelectorIndex,
          tag: lockedAnswerElement ? lockedAnswerElement.tagName : null,
          id: lockedAnswerElement ? lockedAnswerElement.id : null,
        });
        
        // Update radio and styling
        radios.forEach((r, i) => {
          r.checked = (i === idx);
          candidates[i].style.borderColor = (i === idx ? '#10b981' : '#e0e0e0');
          candidates[i].style.background = (i === idx ? '#f0fdf4' : '#fff');
        });
      });
    });
  }
  
  // Handle manual input
  if (needsManualInput) {
    const manualInput = container.querySelector('#fireworks-exam-student-answer-manual');
    manualInput.addEventListener('input', () => {
      selectedAnswer = manualInput.value.trim();
    });
  }

  // Helper to update the displayed student answer when we move to a new submission
  const studentAnswerDiv = container.querySelector('#fireworks-exam-student-answer');
  const studentAnswerTextarea = container.querySelector('#fireworks-exam-student-answer-manual');
  function updateDisplayedAnswer(newText) {
    if (typeof newText !== 'string') return;
    selectedAnswer = newText;
    if (studentAnswerDiv) {
      studentAnswerDiv.textContent = newText;
    }
    if (studentAnswerTextarea) {
      studentAnswerTextarea.value = newText;
    }
  }
  
  // Setup rubric table handlers
  const addRowBtn = container.querySelector('#fireworks-add-rubric-row');
  const rubricTbody = container.querySelector('#fireworks-rubric-tbody');
  const keyMappingContainer = container.querySelector('#fireworks-key-mapping');
  
  // Function to save rubric to localStorage
  function saveRubricToStorage() {
    const rubricRows = rubricTbody.querySelectorAll('tr');
    const rubricData = [];
    for (const row of rubricRows) {
      const points = row.querySelector('.rubric-points').value.trim();
      const criteria = row.querySelector('.rubric-criteria').value.trim();
      if (points && criteria) {
        rubricData.push({ points, criteria });
      }
    }
    if (rubricData.length > 0) {
      localStorage.setItem('fireworks-saved-rubric', JSON.stringify(rubricData));
      console.log("🎆 Fireworks: Saved rubric to localStorage");
    }
  }
  
  // Function to load rubric from localStorage
  function loadRubricFromStorage() {
    const savedRubric = localStorage.getItem('fireworks-saved-rubric');
    if (savedRubric) {
      try {
        const rubricData = JSON.parse(savedRubric);
        rubricTbody.innerHTML = '';
        rubricData.forEach(({ points, criteria }) => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td style="padding: 6px; border: 1px solid #ccc;"><input type="text" class="rubric-points" value="${escapeHtml(points)}" style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px;"></td>
            <td style="padding: 6px; border: 1px solid #ccc;"><input type="text" class="rubric-criteria" value="${escapeHtml(criteria)}" style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px;"></td>
            <td style="padding: 6px; border: 1px solid #ccc; text-align: center;"><button class="rubric-remove-btn" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">×</button></td>
          `;
          rubricTbody.appendChild(row);
          setupRubricRowHandlers(row);
        });
        console.log("🎆 Fireworks: Loaded rubric from localStorage");
        return true;
      } catch (e) {
        console.error('🎆 Fireworks: Error loading saved rubric:', e);
      }
    }
    return false;
  }
  
  // Function to setup handlers for a rubric row
  function setupRubricRowHandlers(row) {
    row.querySelector('.rubric-remove-btn').addEventListener('click', () => {
      if (rubricTbody.children.length > 1) {
        row.remove();
        saveRubricToStorage();
      } else {
        alert('At least one rubric row is required.');
      }
    });
    
    // Save on input change
    row.querySelectorAll('.rubric-points, .rubric-criteria').forEach(input => {
      input.addEventListener('input', saveRubricToStorage);
    });
  }
  
  // Load saved question
  const questionInput = container.querySelector('#fireworks-exam-question');
  const savedQuestion = localStorage.getItem('fireworks-saved-question');
  if (savedQuestion && questionInput) {
    questionInput.value = savedQuestion;
  }
  if (questionInput) {
    questionInput.addEventListener('input', () => {
      localStorage.setItem('fireworks-saved-question', questionInput.value);
    });
  }

  // Load saved rubric or use default
  if (!loadRubricFromStorage()) {
    // Add default row
    const defaultRow = document.createElement('tr');
    defaultRow.innerHTML = `
      <td style="padding: 6px; border: 1px solid #ccc;"><input type="text" class="rubric-points" placeholder="2" style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px;"></td>
      <td style="padding: 6px; border: 1px solid #ccc;"><input type="text" class="rubric-criteria" placeholder="Explains that stratified randomization..." style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px;"></td>
      <td style="padding: 6px; border: 1px solid #ccc; text-align: center;"><button class="rubric-remove-btn" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">×</button></td>
    `;
    rubricTbody.appendChild(defaultRow);
    setupRubricRowHandlers(defaultRow);
  }

  // Build/update the keyboard mapping UI based on current rubric rows
  function rebuildKeyMappingUI() {
    if (!keyMappingContainer) return;
    const rows = rubricTbody.querySelectorAll('tr');
    const seenPoints = new Set();
    const mappings = [];

    rows.forEach((row) => {
      const pointsInput = row.querySelector('.rubric-points');
      if (!pointsInput) return;
      const pts = pointsInput.value.trim();
      if (!pts || seenPoints.has(pts)) return;
      seenPoints.add(pts);
      mappings.push(pts);
    });

    if (mappings.length === 0) {
      keyMappingContainer.innerHTML = '<div style="font-size: 12px; color: #9ca3af;">Add rubric rows above to configure keyboard mappings.</div>';
      return;
    }

    keyMappingContainer.innerHTML = mappings
      .map(
        (pts, idx) => `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <span style="font-size: 12px; color: #374151;">Points <strong>${escapeHtml(pts)}</strong></span>
        <input type="text"
               class="fireworks-key-mapping-input"
               data-points="${escapeHtml(pts)}"
               value="${(idx + 1) % 10}"
               maxlength="1"
               style="width: 40px; padding: 2px 4px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 12px; text-align: center;"
               placeholder="#"
        >
      </div>
    `
      )
      .join('');
  }

  // Initial build and keep in sync when rubric changes
  rebuildKeyMappingUI();
  rubricTbody.addEventListener('input', rebuildKeyMappingUI);
  
  function addRubricRow() {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="padding: 6px; border: 1px solid #ccc;"><input type="text" class="rubric-points" placeholder="0" style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px;"></td>
      <td style="padding: 6px; border: 1px solid #ccc;"><input type="text" class="rubric-criteria" placeholder="Criteria description..." style="width: 100%; padding: 4px; border: 1px solid #ddd; border-radius: 3px;"></td>
      <td style="padding: 6px; border: 1px solid #ccc; text-align: center;"><button class="rubric-remove-btn" style="background: #ef4444; color: white; border: none; padding: 4px 8px; border-radius: 3px; cursor: pointer; font-size: 12px;">×</button></td>
    `;
    rubricTbody.appendChild(row);
    setupRubricRowHandlers(row);
    rebuildKeyMappingUI();
  }
  
  addRowBtn.addEventListener('click', addRubricRow);
  
  // Model selection and VRAM estimation
  const modelInput = container.querySelector('#fireworks-vllm-model');
  const vramEstimate = container.querySelector('#fireworks-vram-estimate');
  
  // Simple VRAM estimation based on model size
  const vramEstimates = {
    'llama-3.2-3b': 6,
    'llama-3.2-1b': 4,
    'llama-3.1-8b': 16,
    'llama-3.1-70b': 140,
    'llama-2-7b': 14,
    'llama-2-13b': 26,
    'mistral-7b': 14,
    'mixtral-8x7b': 90,
    'default': 6
  };
  
  function updateVRAMEstimate() {
    const model = modelInput.value.toLowerCase();
    let estimate = vramEstimates.default;
    
    for (const [key, vram] of Object.entries(vramEstimates)) {
      if (model.includes(key)) {
        estimate = vram;
        break;
      }
    }
    
    vramEstimate.textContent = `~${estimate}GB`;
  }
  
  modelInput.addEventListener('input', updateVRAMEstimate);
  updateVRAMEstimate();
  
  // Load saved settings
  const browserAPI = BROWSER === 'chrome' ? chrome : browser;
  const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
  storageAPI.get(['fireworksVllmUrl', 'fireworksVllmModel'], (result) => {
    if (!browserAPI.runtime.lastError) {
      if (result.fireworksVllmUrl) {
        const urlInput = container.querySelector('#fireworks-vllm-url');
        if (urlInput) urlInput.value = result.fireworksVllmUrl;
      }
      if (result.fireworksVllmModel) {
        modelInput.value = result.fireworksVllmModel;
        updateVRAMEstimate();
      }
    }
  });
  
  // Auto-advance state
  let isAutoGrading = false;
  let autoAdvanceEnabled = false;
  const gradeBtn = container.querySelector('#fireworks-exam-grade-btn');
  const autoAdvanceCheckbox = container.querySelector('#fireworks-auto-advance');
  
  // Keyboard handler for 'z' key to stop auto-grading
  const keyboardHandler = (e) => {
    if ((e.key === 'z' || e.key === 'Z') && isAutoGrading) {
      e.preventDefault();
      e.stopPropagation();
      isAutoGrading = false;
      autoAdvanceEnabled = false;
      gradeBtn.textContent = 'Grade Answer';
      gradeBtn.style.background = '';
      const statusDiv = container.querySelector('#fireworks-exam-status');
      statusDiv.textContent = 'Auto-grading stopped (pressed z).';
      statusDiv.style.color = '#666';
      console.log('🎆 Fireworks: Auto-grading stopped by keyboard shortcut');
    }
  };
  document.addEventListener('keydown', keyboardHandler);
  
  // Clean up listener when container is removed
  const originalRemove = container.remove.bind(container);
  container.remove = function() {
    document.removeEventListener('keydown', keyboardHandler);
    originalRemove();
  };
  
  // Manual "Next" button: let user advance page after reviewing GPT result
  const manualNextBtn = container.querySelector('#fireworks-exam-next-btn');
  if (manualNextBtn) {
    manualNextBtn.addEventListener('click', () => {
      const statusDiv = container.querySelector('#fireworks-exam-status');
      const nextBtn = findNextUngradedButton();
      if (nextBtn) {
        nextBtn.click();
        if (statusDiv) {
          statusDiv.textContent = 'Moved to next submission (via Next Ungraded).';
          statusDiv.style.color = '#666';
        }
      } else {
        // Fallback: press 'z'
        simulateKeyPress('z');
        if (statusDiv) {
          statusDiv.textContent = 'Sent "z" shortcut to move to next submission.';
          statusDiv.style.color = '#666';
        }
      }
      
      // Wait for page transition then refresh the student answer
      const refreshPage = () => {
        let updatedText = '';
        let foundElement = false;
        if (lockedAnswerSelector) {
          try {
            const element = pickElementBySelectorAndIndex(lockedAnswerSelector, lockedAnswerSelectorIndex);
            if (element) {
              updatedText = extractTextFromElement(element).trim();
              lockedAnswerElement = element;
              foundElement = true;
            }
          } catch(e) {}
        }
        if (!foundElement) {
          const newCandidates = findStudentAnswerElements();
          if (newCandidates.length > 0) {
            const bestMatch = newCandidates[selectedAnswerIndex] || newCandidates[0];
            updatedText = bestMatch.text;
            lockedAnswerSelector = bestMatch.selector || generateElementSelector(bestMatch.element);
            if (typeof bestMatch.selectorIndex === 'number') {
              lockedAnswerSelectorIndex = bestMatch.selectorIndex;
            }
            lockedAnswerElement = bestMatch.element;
            foundElement = true;
          }
        }
        if (foundElement) {
          updateDisplayedAnswer(updatedText);
          const resultDiv = container.querySelector('#fireworks-exam-result');
          if (resultDiv) resultDiv.style.display = 'none';
        } else {
          // If we couldn't find the text immediately, try again after a longer delay (network slow)
          setTimeout(() => {
            if (lockedAnswerSelector) {
              try {
                const element = pickElementBySelectorAndIndex(lockedAnswerSelector, lockedAnswerSelectorIndex);
                if (element) {
                  updateDisplayedAnswer(extractTextFromElement(element).trim());
                  const resultDiv = container.querySelector('#fireworks-exam-result');
                  if (resultDiv) resultDiv.style.display = 'none';
                }
              } catch(e) {}
            }
          }, 1500);
        }
      };
      
      setTimeout(refreshPage, 600);
    });
  }

  // Grade button handler with auto-advance support
  gradeBtn.addEventListener('click', async () => {
    const useHttp = container.querySelector('#fireworks-use-http').checked;
    const model = modelInput.value.trim();
    const vllmUrl = container.querySelector('#fireworks-vllm-url').value.trim() || 'http://localhost:8000/v1/chat/completions';
    const statusDiv = container.querySelector('#fireworks-exam-status');
    const resultDiv = container.querySelector('#fireworks-exam-result');
    const resultContent = container.querySelector('#fireworks-exam-result-content');
    
    if (!useHttp) {
      alert('Please enable HTTP API to use browser-based grading.');
      return;
    }
    
    // Get rubric from table
    const rubricRows = rubricTbody.querySelectorAll('tr');
    const rubricData = [];
    for (const row of rubricRows) {
      const points = row.querySelector('.rubric-points').value.trim();
      const criteria = row.querySelector('.rubric-criteria').value.trim();
      if (points && criteria) {
        rubricData.push({ points, criteria });
      }
    }
    
    if (rubricData.length === 0) {
      alert('Please enter at least one rubric row with both points and criteria.');
      return;
    }
    
    // Format rubric as text
    const rubric = rubricData.map(r => `${r.points}\t${r.criteria}`).join('\n');
    
    // Save settings
    storageAPI.set({ 
      fireworksVllmUrl: vllmUrl,
      fireworksVllmModel: model
    }, () => {});
    
    // Build key mapping from UI (points -> digit)
    const keyMappingInputs = container.querySelectorAll('.fireworks-key-mapping-input');
    const keyMapping = {};
    keyMappingInputs.forEach((input) => {
      const digit = (input.value || '').trim();
      const pts = input.getAttribute('data-points') || '';
      if (digit && /^[0-9]$/.test(digit) && pts) {
        keyMapping[pts] = digit;
      }
    });

    // Reset external stop flag when (re)starting
    fireworksGptAutoStopRequested = false;

    // Get selected answer (LOCKED for this viewer session)
    let currentAnswer = '';

    if (!needsManualInput) {
      try {
        // Prefer the locked element (fast + stable)
        if (lockedAnswerElement && document.contains(lockedAnswerElement)) {
          currentAnswer = extractTextFromElement(lockedAnswerElement).trim();
          logExtractedAnswerBox({
            phase: 'grade_click_locked_element',
            selector: lockedAnswerSelector,
            element: lockedAnswerElement,
            text: currentAnswer,
          });
        } else if (lockedAnswerSelector) {
          // Re-find if DOM was replaced
          const el = pickElementBySelectorAndIndex(lockedAnswerSelector, lockedAnswerSelectorIndex);
          if (el) {
            lockedAnswerElement = el;
            currentAnswer = extractTextFromElement(el).trim();
            logExtractedAnswerBox({
              phase: 'grade_click_locked_selector',
              selector: lockedAnswerSelector,
              element: el,
              text: currentAnswer,
            });
          }
        }
      } catch (e) {
        console.error('🎆 Fireworks: Error using locked answer box:', e);
      }
    }
    
    if (!currentAnswer) {
      if (needsManualInput) {
        const manualInput = container.querySelector('#fireworks-exam-student-answer-manual');
        currentAnswer = (manualInput.value || '').trim();
      } else {
        // Fallback: whatever is currently displayed/selected in the viewer list
        currentAnswer = (answerCandidates[selectedAnswerIndex]?.text || '').trim();
      }
    }
    
    // Get question
    const questionInput = container.querySelector('#fireworks-exam-question');
    const currentQuestion = questionInput ? (questionInput.value || '').trim() : '';

    // If the answer is empty, skip GPT and move to next submission for manual grading
    if (!currentAnswer) {
      const statusDiv = container.querySelector('#fireworks-exam-status');
      if (statusDiv) {
        statusDiv.textContent = 'Answer is empty. Skipping to next submission for manual grading...';
        statusDiv.style.color = '#666';
      }
      // Reset any running auto-grading state
      isAutoGrading = false;
      autoAdvanceEnabled = false;
      fireworksGptAutoStopRequested = false;
      gradeBtn.textContent = 'Grade Answer';
      gradeBtn.style.background = '';
      const globalStopBtn = document.getElementById('fireworks-stop-autograde-btn');
      if (globalStopBtn) {
        globalStopBtn.style.display = 'none';
      }
      // Try to move to next submission (or fall back to 'z')
      const nextBtn = findNextUngradedButton();
      if (nextBtn) {
        nextBtn.click();
      } else {
        simulateKeyPress('z');
      }
      return;
    }

    // Keep the "Student Answer" display in sync with what we're grading
    updateDisplayedAnswer(currentAnswer);

    // Debug helper: find notebook question (cell below keyword cell) and parse current answer.
    try {
      await debugNotebookQuestionAndStudentResponse(currentAnswer, 'grade');
    } catch (debugErr) {
      console.error('🎆 Fireworks: Failed notebook/response debug extraction:', debugErr);
    }
    
    // Auto-advance mode
    if (autoAdvanceCheckbox.checked && !isAutoGrading) {
      isAutoGrading = true;
      autoAdvanceEnabled = true;
      gradeBtn.textContent = 'Stop Auto-Grading (Press z)';
      gradeBtn.style.background = '#ef4444';
      const globalStopBtn = document.getElementById('fireworks-stop-autograde-btn');
      if (globalStopBtn) {
        globalStopBtn.style.display = 'inline-flex';
      }
      
      const gradeAndAdvance = async () => {
        if (!isAutoGrading || fireworksGptAutoStopRequested) {
          isAutoGrading = false;
          autoAdvanceEnabled = false;
          gradeBtn.textContent = 'Grade Answer';
          gradeBtn.style.background = '';
          statusDiv.textContent = 'Auto-grading stopped.';
          statusDiv.style.color = '#666';
          const globalStopBtn = document.getElementById('fireworks-stop-autograde-btn');
          if (globalStopBtn) {
            globalStopBtn.style.display = 'none';
          }
          return;
        }
        
        try {
          statusDiv.textContent = 'Grading...';
          statusDiv.style.color = '#666';
          resultDiv.style.display = 'none';
          
          // Grade with vLLM
          const gradeResult = await gradeWithVllm(currentAnswer, rubric, currentQuestion, vllmUrl, model);
          
          // Display result briefly
          resultContent.innerHTML = `
            <div class="fireworks-exam-grade-output">
              <pre>${escapeHtml(gradeResult.grading)}</pre>
            </div>
            <div class="fireworks-exam-grade-score" style="margin-top: 10px;">
              <strong>Suggested Score:</strong> <span id="fireworks-suggested-score">${gradeResult.score !== null ? gradeResult.score : 'N/A'}</span>
            </div>
          `;
          resultDiv.style.display = 'block';
          
          // Apply score automatically (try key mapping first, then numeric field)
          if (gradeResult.score !== null) {
            let applied = false;
            if (Object.keys(keyMapping).length > 0) {
              applied = applyScoreWithKeyMapping(gradeResult.score, rubricData, keyMapping);
            }
            if (!applied) {
              applied = applyScoreToGradescope(gradeResult.score);
            }
            if (applied) {
              statusDiv.textContent = `Score ${gradeResult.score} applied. Advancing...`;
              statusDiv.style.color = '#10b981';
              
              // Wait a bit, then advance to next page
              setTimeout(() => {
                const nextBtn = findNextUngradedButton();
                if (nextBtn && isAutoGrading) {
                  nextBtn.click();
                  
                  // Wait for page to load, then continue grading
                  setTimeout(() => {
                    if (!isAutoGrading) return;
                    
                    // Wait for DOM to be ready and refresh the displayed student answer
                    const checkPageReady = () => {
                      // Use locked selector (+ index) to extract answer on the new page
                      if (lockedAnswerSelector) {
                        try {
                          const element = pickElementBySelectorAndIndex(lockedAnswerSelector, lockedAnswerSelectorIndex);
                          if (element) {
                            const text = extractTextFromElement(element).trim();
                            if (text.length > 0) {
                              currentAnswer = text;
                              logExtractedAnswerBox({
                                phase: 'autoadvance_saved_selector',
                                selector: lockedAnswerSelector,
                                element,
                                text: currentAnswer,
                              });
                              lockedAnswerElement = element;
                              updateDisplayedAnswer(currentAnswer);
                              // Continue grading
                              setTimeout(() => gradeAndAdvance(), 500);
                              return;
                            }
                          }
                        } catch (e) {
                          console.error('🎆 Fireworks: Error using saved selector:', e);
                        }
                      }

                      // Do NOT auto-fallback to new detection here; that causes the answer box to "jump".
                      // Instead, stop and ask the user to re-select the answer box for this new page.
                      if (document.readyState === 'loading') {
                        setTimeout(checkPageReady, 500);
                        return;
                      }

                      isAutoGrading = false;
                      autoAdvanceEnabled = false;
                      gradeBtn.textContent = 'Grade Answer';
                      gradeBtn.style.background = '';
                      statusDiv.textContent =
                        'Stopped: locked answer box not found on this page. Click 🔁 to re-select, then Grade again.';
                      statusDiv.style.color = '#f59e0b';
                    };
                    checkPageReady();
                  }, 2000); // Wait 2 seconds for page to load
                } else {
                  isAutoGrading = false;
                  statusDiv.textContent = 'Auto-grading stopped: No "Next Ungraded" button found.';
                  gradeBtn.textContent = 'Grade Answer';
                  gradeBtn.style.background = '';
                }
              }, 500);
            } else {
              isAutoGrading = false;
              statusDiv.textContent = 'Auto-grading stopped: Could not apply score.';
              gradeBtn.textContent = 'Grade Answer';
              gradeBtn.style.background = '';
            }
          } else {
            isAutoGrading = false;
            statusDiv.textContent = 'Auto-grading stopped: No score generated.';
            gradeBtn.textContent = 'Grade Answer';
            gradeBtn.style.background = '';
          }
        } catch (error) {
          console.error('🎆 Fireworks: Error in auto-grading:', error);
          isAutoGrading = false;
          statusDiv.textContent = 'Error: ' + error.message;
          statusDiv.style.color = '#ef4444';
          gradeBtn.textContent = 'Grade Answer';
          gradeBtn.style.background = '';
        }
      };
      
      // Start grading
      gradeAndAdvance();
      return;
    }
    
    // Stop auto-grading
    if (isAutoGrading) {
      isAutoGrading = false;
      autoAdvanceEnabled = false;
      fireworksGptAutoStopRequested = true;
      gradeBtn.textContent = 'Grade Answer';
      gradeBtn.style.background = '';
      statusDiv.textContent = 'Auto-grading stopped.';
      statusDiv.style.color = '#666';
      const globalStopBtn = document.getElementById('fireworks-stop-autograde-btn');
      if (globalStopBtn) {
        globalStopBtn.style.display = 'none';
      }
      return;
    }
    
    // Single grading mode
    statusDiv.textContent = 'Grading...';
    statusDiv.style.color = '#666';
    resultDiv.style.display = 'none';
    
    try {
      const gradeResult = await gradeWithVllm(currentAnswer, rubric, currentQuestion, vllmUrl, model);
      
      // Display result
      resultContent.innerHTML = `
        <div class="fireworks-exam-grade-output">
          <pre>${escapeHtml(gradeResult.grading)}</pre>
        </div>
        <div class="fireworks-exam-grade-score" style="margin-top: 10px;">
          <strong>Suggested Score:</strong> <span id="fireworks-suggested-score">${gradeResult.score !== null ? gradeResult.score : 'N/A'}</span>
        </div>
      `;
      
      resultDiv.style.display = 'block';
      statusDiv.textContent = 'Grading complete!';
      statusDiv.style.color = '#10b981';
      
      // Setup apply score button
      const applyBtn = container.querySelector('#fireworks-exam-apply-score');
      applyBtn.onclick = () => {
        if (gradeResult.score !== null) {
          applyScoreToGradescope(gradeResult.score);
        } else {
          alert('No score was generated. Please review the grading result manually.');
        }
      };
      
    } catch (error) {
      console.error('🎆 Fireworks: Error grading with vLLM:', error);
      statusDiv.textContent = 'Error: ' + error.message;
      statusDiv.style.color = '#ef4444';
      resultContent.innerHTML = `<div class="fireworks-exam-error">Error: ${escapeHtml(error.message)}</div>`;
      resultDiv.style.display = 'block';
    }
  });
}

// Generate Python script for local vLLM execution
function generatePythonScript(studentAnswer, rubric, question, model) {
  const rubricFormatted = rubric.split('\n').map(line => {
    const [points, ...criteriaParts] = line.split('\t');
    const criteria = criteriaParts.join('\t');
    return `${points}\t${criteria}`;
  }).join('\n');
  
  const questionContextPython = question && question.trim() ? `\nQUESTION = """${question.replace(/`/g, '\\`').replace(/\$/g, '\\$')}"""\n` : '';
  const questionContextPrompt = question && question.trim() ? `\nQuestion:\n{QUESTION}\n` : '';

  const script = `#!/usr/bin/env python3
"""
Fireworks Exam Grading Script
Run this script locally with: python grade_exam.py

Requirements:
- GPU with sufficient VRAM (check estimate in extension)
- vLLM installed: pip install vllm
- Python 3.10+

Usage:
    python grade_exam.py
"""

import json
import sys
from vllm import LLM, SamplingParams

# Configuration
MODEL_NAME = "${model}"
STUDENT_ANSWER = """${studentAnswer.replace(/`/g, '\\`').replace(/\$/g, '\\$')}"""
${questionContextPython}
RUBRIC = """${rubricFormatted.replace(/`/g, '\\`').replace(/\$/g, '\\$')}"""

def main():
    print("🚀 Initializing vLLM with model:", MODEL_NAME)
    print("⚠️  Make sure you have a GPU with sufficient VRAM!")
    print()
    
    try:
        # Initialize vLLM
        llm = LLM(model=MODEL_NAME, trust_remote_code=True)
        
        # Construct prompt
        prompt = f"""You are a teaching assistant grading a student's exam answer. Use the following rubric to grade the answer.
${questionContextPrompt}
Rubric (Points | Criteria):
{RUBRIC}

Student Answer:
{STUDENT_ANSWER}

Please provide:
1. A detailed grading explanation matching the student's answer to the rubric criteria
2. The exact score/points to assign (as a number, matching one of the point values in the rubric)

Format your response as:
SCORE: [number]
EXPLANATION: [detailed explanation]"""

        # Set sampling parameters
        sampling_params = SamplingParams(
            temperature=0.3,
            max_tokens=1000,
            stop=['\\n\\n\\n']
        )
        
        print("📝 Grading student answer...")
        print()
        
        # Generate response
        outputs = llm.generate([prompt], sampling_params)
        
        # Extract result
        grading_text = outputs[0].outputs[0].text
        
        # Parse score
        score = None
        score_match = None
        for line in grading_text.split('\\n'):
            if 'SCORE' in line.upper():
                import re
                score_match = re.search(r'SCORE[^-\\d]*(-?[\\d.]+)', line, re.IGNORECASE)
                if score_match:
                    score = float(score_match.group(1))
                    break
        
        # Print results
        print("=" * 60)
        print("GRADING RESULT")
        print("=" * 60)
        print()
        print(grading_text)
        print()
        print("=" * 60)
        if score is not None:
            print(f"SUGGESTED SCORE: {score}")
        else:
            print("SUGGESTED SCORE: Could not parse score from response")
        print("=" * 60)
        
        # Return JSON for potential automation
        result = {
            "grading": grading_text,
            "score": score
        }
        
        print()
        print("JSON Result:")
        print(json.dumps(result, indent=2))
        
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        print()
        print("Troubleshooting:")
        print("1. Make sure vLLM is installed: pip install vllm")
        print("2. Make sure you have a GPU with sufficient VRAM")
        print("3. Make sure the model name is correct")
        sys.exit(1)

if __name__ == "__main__":
    main()
`;

  // Download the script
  const blob = new Blob([script], { type: 'text/x-python' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'grade_exam.py';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log("🎆 Fireworks: Python script generated and downloaded");
}

// Grade student answer using vLLM
async function gradeWithVllm(studentAnswer, rubric, question, vllmUrl, model = 'default') {
  console.log("🎆 Fireworks: Grading with vLLM at", vllmUrl);
  
  // Format rubric for prompt
  const rubricFormatted = rubric.split('\n').map(line => {
    const [points, ...criteriaParts] = line.split('\t');
    const criteria = criteriaParts.join('\t');
    return `${points}\t${criteria}`;
  }).join('\n');
  
  // Construct prompt for grading (balanced speed + robustness)
  const questionContext = question && question.trim() ? `\nQuestion:\n${question.trim()}\n` : '';
  const prompt = `You are a teaching assistant grading a student's short exam answer. Use the following rubric to choose a score.
${questionContext}
Rubric (Points | Criteria):
${rubricFormatted}

Student Answer:
${studentAnswer}

You MUST respond in exactly TWO lines and include a numeric score that matches ONE of the point values from the rubric above.
Line 1 MUST be: SCORE: <number>
Line 2 MUST be: EXPLANATION: <very short (<= 1 sentence) reason referencing the rubric>
Do NOT output any other numbers besides the SCORE value.`;

  // Choose body structure based on endpoint type
  const isChatEndpoint = vllmUrl.includes('/chat/completions');
  const requestBody = {
    model: model && model !== 'default' ? model : undefined,
    max_tokens: 120,
    temperature: 0.2,
    top_p: 0.9,
    stop: ['\n\n\n'],
  };

  if (isChatEndpoint) {
    requestBody.messages = [
      { role: 'system', content: 'You are a teaching assistant grading a student\'s short exam answer.' },
      { role: 'user', content: prompt }
    ];
  } else {
    requestBody.prompt = prompt;
  }

  try {
    // Use background script to perform the fetch (avoids mixed-content & CORS from content script)
    const browserAPI = typeof chrome !== 'undefined' ? chrome : browser;
    const bgResponse = await new Promise((resolve, reject) => {
      browserAPI.runtime.sendMessage(
        {
          action: 'vllmFetch',
          url: vllmUrl,
          body: requestBody,
        },
        (response) => {
          const lastError = browserAPI.runtime && browserAPI.runtime.lastError;
          if (lastError) {
            console.error('🎆 Fireworks: vllmFetch runtime error:', lastError);
            reject(new Error(lastError.message || String(lastError)));
            return;
          }
          resolve(response);
        }
      );
    });

    if (!bgResponse || !bgResponse.ok) {
      if (bgResponse && bgResponse.status) {
        throw new Error(
          `vLLM API error (${bgResponse.status}): ${
            bgResponse.data ? JSON.stringify(bgResponse.data) : bgResponse.error || 'Unknown error'
          }`
        );
      }
      throw new Error(
        bgResponse && bgResponse.error
          ? bgResponse.error
          : 'Could not reach vLLM via background fetch.'
      );
    }

    const data = bgResponse.data || {};
    
    // Extract text from response (OpenAI-compatible format)
    let gradingText = '';
    if (data.choices && data.choices.length > 0) {
      gradingText = data.choices[0].text || data.choices[0].message?.content || '';
    } else if (data.text) {
      gradingText = data.text;
    } else {
      throw new Error('Unexpected response format from vLLM API');
    }
    
    // Parse score from response
    let score = null;
    // Preferred: line starting with SCORE
    let m = gradingText.match(/SCORE[^-0-9]*(-?[0-9]+(\.[0-9]+)?)/i);
    if (m && m[1]) {
      score = parseFloat(m[1]);
    } else {
      // Fallback: any standalone number in the text
      const anyNum = gradingText.match(/(-?[0-9]+(\.[0-9]+)?)/);
      if (anyNum && anyNum[1]) {
        score = parseFloat(anyNum[1]);
      }
    }
    
    return {
      grading: gradingText,
      score: score
    };
    
  } catch (error) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      throw new Error('Could not connect to vLLM API. Make sure vLLM is running at ' + vllmUrl);
    }
    throw error;
  }
}

// Apply score to Gradescope
function applyScoreToGradescope(score) {
  const input = findScoreInput();
  if (!input) {
    console.warn('🎆 Fireworks: Could not find score input on Gradescope page.');
    return false;
  }
  
  // Set the value in a way React/Vue-style frameworks will notice
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(input, String(score));
  } else {
    input.value = String(score);
  }
  
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  
  console.log("🎆 Fireworks: Applied score", score, "to Gradescope");
  
  // Show confirmation
  const statusDiv = document.getElementById('fireworks-exam-status');
  if (statusDiv) {
    statusDiv.textContent = `Score ${score} applied to Gradescope!`;
    statusDiv.style.color = '#10b981';
  }
  
  return true;
}

// Try to apply score by pressing a mapped rubric hotkey (0–9) instead of typing the number.
// Returns true if a key was pressed, false otherwise.
function applyScoreWithKeyMapping(score, rubricData, keyMapping) {
  if (score == null || !rubricData || !Array.isArray(rubricData)) return false;
  if (!keyMapping || Object.keys(keyMapping).length === 0) return false;

  const numericScore = parseFloat(score);
  if (Number.isNaN(numericScore)) return false;

  // Find a rubric row whose points match the score (numerically)
  const match = rubricData.find((r) => {
    const pts = parseFloat(r.points);
    return !Number.isNaN(pts) && pts === numericScore;
  });

  if (!match) {
    console.log('🎆 Fireworks: No rubric row matched score', score);
    return false;
  }

  const key = String(keyMapping[match.points] || '');
  if (!/^[0-9]$/.test(key)) {
    console.log('🎆 Fireworks: No valid key mapping for points', match.points);
    return false;
  }

  console.log('🎆 Fireworks: Applying score via key mapping', { score, points: match.points, key });
  // Use the same helper as the Gradescope autopilot to simulate the key press.
  simulateKeyPress(key);
  return true;
}

// ================================
// Zoom and Width Controls
// ================================

function setupZoomControls(container) {
  const zoomInBtn = container.querySelector('#fireworks-zoom-in');
  const zoomOutBtn = container.querySelector('#fireworks-zoom-out');
  const resetZoomBtn = container.querySelector('#fireworks-reset-zoom');
  const zoomLevelDisplay = container.querySelector('#fireworks-zoom-level');
  const contentArea = container.querySelector('#fireworks-content-zoomable');
  
  if (!zoomInBtn || !zoomOutBtn || !resetZoomBtn || !zoomLevelDisplay || !contentArea) {
    console.warn('🎆 Fireworks: Zoom controls not found');
    return;
  }
  
  let currentZoom = 100;
  
  function updateZoom(zoom) {
    currentZoom = Math.max(50, Math.min(200, zoom)); // Limit between 50% and 200%
    contentArea.style.transform = `scale(${currentZoom / 100})`;
    contentArea.style.transformOrigin = 'top left';
    zoomLevelDisplay.textContent = currentZoom + '%';
  }
  
  zoomInBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    updateZoom(currentZoom + 10);
  });
  
  zoomOutBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    updateZoom(currentZoom - 10);
  });
  
  resetZoomBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    updateZoom(100);
  });
  
  // Initialize zoom
  updateZoom(100);
}

// Apply cell width from slider - can be called when notebook content is rendered (e.g. after displayNotebookPreview)
function applyCellWidthFromSlider() {
  const container = document.getElementById('fireworks-viewer-container');
  if (!container) {
    console.log('🎆 Fireworks: applyCellWidthFromSlider - container not found');
    return;
  }
  const widthSlider = container.querySelector('#fireworks-width-slider');
  const widthValueDisplay = container.querySelector('#fireworks-width-value');
  if (!widthSlider || !widthValueDisplay) {
    console.log('🎆 Fireworks: applyCellWidthFromSlider - controls not found');
    return;
  }
  
  // Find cells container - it should be inside #fireworks-content-zoomable
  const contentArea = container.querySelector('#fireworks-content-zoomable');
  if (!contentArea) {
    console.log('🎆 Fireworks: applyCellWidthFromSlider - content area not found');
    return;
  }
  
  const cellsContainer = contentArea.querySelector('.fireworks-cells');
  if (!cellsContainer) {
    console.log('🎆 Fireworks: applyCellWidthFromSlider - cells container not found, will retry');
    // Retry after a short delay
    setTimeout(() => {
      applyCellWidthFromSlider();
    }, 100);
    return;
  }
  
  const width = Math.max(50, Math.min(100, parseInt(widthSlider.value) || 60));
  
  // Calculate width relative to the content area (which has padding: 20px)
  // Get the actual available width of the content area
  // Force a reflow to ensure dimensions are calculated
  void contentArea.offsetWidth;
  const contentAreaWidth = contentArea.offsetWidth || contentArea.clientWidth;
  
  // If width is 0, wait a bit for layout to complete
  if (contentAreaWidth === 0) {
    console.log('🎆 Fireworks: applyCellWidthFromSlider - content area width is 0, will retry');
    setTimeout(() => {
      applyCellWidthFromSlider();
    }, 50);
    return;
  }
  
  if (contentAreaWidth > 0) {
    // Account for padding (20px on each side = 40px total)
    const availableWidth = contentAreaWidth - 40;
    const actualWidth = (availableWidth * width / 100) + 'px';
    
    // Override min-width to allow max-width to work properly
    cellsContainer.style.setProperty('max-width', actualWidth, 'important');
    cellsContainer.style.setProperty('min-width', '0', 'important');
    cellsContainer.style.setProperty('width', '100%', 'important');
    cellsContainer.style.setProperty('margin', '0 auto', 'important');
    console.log('🎆 Fireworks: Applied cell width:', actualWidth, '(', width + '%', 'of', availableWidth + 'px available width)');
  } else {
    // Fallback to percentage if we can't calculate
    cellsContainer.style.setProperty('max-width', width + '%', 'important');
    cellsContainer.style.setProperty('min-width', '0', 'important');
    cellsContainer.style.setProperty('width', '100%', 'important');
    cellsContainer.style.setProperty('margin', '0 auto', 'important');
    console.log('🎆 Fireworks: Applied cell width:', width + '%', '(percentage fallback)');
  }
  
  widthValueDisplay.textContent = width + '%';
  widthSlider.value = width;
}

function setupWidthControl(container) {
  const widthSlider = container.querySelector('#fireworks-width-slider');
  const widthValueDisplay = container.querySelector('#fireworks-width-value');
  
  if (!widthSlider || !widthValueDisplay) {
    console.warn('🎆 Fireworks: Width controls not found');
    return;
  }
  
  function updateWidth(widthPercent) {
    const width = Math.max(50, Math.min(100, widthPercent));
    
    // Apply max-width to the notebook cells container (not width, to allow horizontal scroll)
    // Cells might be inside .fireworks-loading or directly in content
    let cellsContainer = container.querySelector('.fireworks-cells');
    if (!cellsContainer) {
      const contentArea = container.querySelector('#fireworks-content-zoomable');
      if (contentArea) {
        cellsContainer = contentArea.querySelector('.fireworks-cells');
      }
    }
    
    if (cellsContainer) {
      // Calculate width relative to the content area
      const contentArea = container.querySelector('#fireworks-content-zoomable');
      if (contentArea) {
        const contentAreaWidth = contentArea.offsetWidth || contentArea.clientWidth;
        if (contentAreaWidth > 0) {
          // Account for padding (20px on each side = 40px total)
          const availableWidth = contentAreaWidth - 40;
          const actualWidth = (availableWidth * width / 100) + 'px';
          // Override min-width to allow max-width to work properly
          cellsContainer.style.setProperty('max-width', actualWidth, 'important');
          cellsContainer.style.setProperty('min-width', '0', 'important');
          cellsContainer.style.setProperty('width', '100%', 'important');
          cellsContainer.style.setProperty('margin', '0 auto', 'important');
          console.log('🎆 Fireworks: updateWidth applied:', actualWidth, '(', width + '%', 'of', availableWidth + 'px)');
        } else {
          // Fallback to percentage
          cellsContainer.style.setProperty('max-width', width + '%', 'important');
          cellsContainer.style.setProperty('min-width', '0', 'important');
          cellsContainer.style.setProperty('width', '100%', 'important');
          cellsContainer.style.setProperty('margin', '0 auto', 'important');
          console.log('🎆 Fireworks: updateWidth applied:', width + '%', '(percentage fallback)');
        }
      } else {
        // Fallback if content area not found
        cellsContainer.style.setProperty('max-width', width + '%', 'important');
        cellsContainer.style.setProperty('min-width', '0', 'important');
        cellsContainer.style.setProperty('width', '100%', 'important');
        cellsContainer.style.setProperty('margin', '0 auto', 'important');
        console.log('🎆 Fireworks: updateWidth applied:', width + '%', '(fallback - no content area)');
      }
    } else {
      console.log('🎆 Fireworks: updateWidth - cells container not found');
    }
    
    widthValueDisplay.textContent = width + '%';
    widthSlider.value = width;
  }
  
  widthSlider.addEventListener('input', (e) => {
    e.stopPropagation();
    updateWidth(parseInt(e.target.value));
  });
  
  // Initialize width - wait for cells to be loaded
  // Use applyCellWidthFromSlider instead of updateWidth to ensure consistent behavior
  const checkForCells = setInterval(() => {
    const contentArea = container.querySelector('#fireworks-content-zoomable');
    if (contentArea) {
      const cellsContainer = contentArea.querySelector('.fireworks-cells');
      if (cellsContainer) {
        const contentAreaWidth = contentArea.offsetWidth || contentArea.clientWidth;
        // Only apply if content area has dimensions (layout is ready)
        if (contentAreaWidth > 0) {
          clearInterval(checkForCells);
          // Use applyCellWidthFromSlider to ensure it uses the slider's current value (60)
          applyCellWidthFromSlider();
        }
      }
    }
  }, 100);
  
  // Stop checking after 5 seconds
  setTimeout(() => clearInterval(checkForCells), 5000);
}