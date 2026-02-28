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
  
  function sendFetchMessage(connections, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = 500; // 500ms delay between retries
    
    // Check if background script is available
    if (!browserAPI.runtime || !browserAPI.runtime.sendMessage) {
      console.error('🎆 Fireworks: Runtime API not available');
      const loading = document.querySelector('.fireworks-loading');
      if (loading) {
        loading.innerHTML = `<div class="fireworks-error">Error: Extension runtime not available. Please reload the page and try again.</div>`;
      }
      return;
    }
    
    browserAPI.runtime.sendMessage(
      { action: 'fetchNotebook', url: downloadUrl, connections: connections },
      (response) => {
      // Check for runtime errors (e.g., service worker not running)
      if (browserAPI.runtime.lastError) {
        const errorMsg = browserAPI.runtime.lastError.message;
        console.error('🎆 Fireworks: Runtime error:', errorMsg);
        
        // If it's a connection error and we haven't retried too many times, retry
        if ((errorMsg.includes('connection') || errorMsg.includes('Receiving end does not exist')) && retryCount < maxRetries) {
          console.log(`🎆 Fireworks: Retrying message send (attempt ${retryCount + 1}/${maxRetries})...`);
          setTimeout(() => {
            sendFetchMessage(connections, retryCount + 1);
          }, retryDelay * (retryCount + 1)); // Exponential backoff
          return;
        }
        
        // Show error to user
        const loading = document.querySelector('.fireworks-loading');
        if (loading) {
          loading.innerHTML = `<div class="fireworks-error">Error: ${escapeHtml(errorMsg)}<br><br>Try downloading the file directly instead.</div>`;
        }
        return;
      }
      
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
  const existingButton = document.getElementById('fireworks-preview-btn');
  if (existingButton) {
    console.log("🎆 Fireworks: Button already exists, skipping injection");
    buttonInjected = true;
    return;
  }
  
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
  
  if (notebookLinksForInjection.length === 0) {
    console.log("🎆 Fireworks: No notebook links found, skipping button injection");
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
  
  if (downloadSection) {
    console.log("🎆 Fireworks: Injecting button into section");
    
    // Create button container with proper spacing
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; gap: 12px; align-items: center; margin: 10px 0; flex-wrap: wrap; position: relative; z-index: 9999;';
    
    // Preview button
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
    
    buttonContainer.appendChild(btn);
    buttonContainer.appendChild(settingsBtn);
    
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
    if (!searchInput) {
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
  storageAPI.get(['fireworksConnections', 'fireworksSearchText'], (result) => {
    if (browserAPI.runtime.lastError) {
      console.error('🎆 Fireworks: Error loading settings:', browserAPI.runtime.lastError);
      // Fallback to default if error
      const savedConnections = 20;
      const savedSearchText = '';
      createPanelWithValue(panel, savedConnections, savedSearchText);
      return;
    }
    const savedConnections = (result && result.fireworksConnections) ? result.fireworksConnections : 20;
    const savedSearchText = (result && result.fireworksSearchText) ? result.fireworksSearchText : '';
    
    createPanelWithValue(panel, savedConnections, savedSearchText);
  });
}

function createPanelWithValue(panel, savedConnections, savedSearchText) {
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
        <p style="font-size: 12px; color: #666; margin: 0 0 20px 0;">This text will be highlighted when notebook opens (like Ctrl+F)</p>
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
    const connections = parseInt(connectionsInput.value) || defaultValue || 20;
    const clampedConnections = Math.max(1, Math.min(50, connections));
    const searchText = (searchTextInput.value || '').trim();
    
    const browserAPI = BROWSER === 'chrome' ? chrome : browser;
    const storageAPI = browserAPI.storage.local || browserAPI.storage.sync;
    storageAPI.set({ 
      fireworksConnections: clampedConnections,
      fireworksSearchText: searchText
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
        storageAPI.get(['fireworksConnections', 'fireworksSearchText'], (result) => {
          if (!browserAPI.runtime.lastError) {
            const connectionsInput = document.getElementById('fireworks-connections-input-page');
            const searchTextInput = document.getElementById('fireworks-search-text-input-page');
            if (connectionsInput && result && result.fireworksConnections) {
              connectionsInput.value = result.fireworksConnections;
            }
            if (searchTextInput && result && result.fireworksSearchText) {
              searchTextInput.value = result.fireworksSearchText;
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
  storageAPI.get(['fireworksConnections', 'fireworksSearchText'], (result) => {
    if (!browserAPI.runtime.lastError) {
      const connectionsInput = document.getElementById('fireworks-connections-input-page');
      const searchTextInput = document.getElementById('fireworks-search-text-input-page');
      if (connectionsInput && result && result.fireworksConnections) {
        connectionsInput.value = result.fireworksConnections;
      }
      if (searchTextInput && result && result.fireworksSearchText) {
        searchTextInput.value = result.fireworksSearchText;
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