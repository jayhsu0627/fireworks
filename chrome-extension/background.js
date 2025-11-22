// Background service worker for Fireworks extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Fireworks extension installed');
});

// Handle fetch requests from content script to avoid CORS issues
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'fetchNotebook') {
    // Store the tab ID from the sender
    const tabId = sender && sender.tab ? sender.tab.id : null;
    
    // Send initial status message to confirm background script is running
    if (tabId) {
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'DOWNLOAD_STATUS',
          message: 'Background script is running - starting download...'
        }, () => {});
      } catch (err) {
        console.error('🎆 Fireworks [Background]: Error sending initial status:', err);
      }
    }
    
    // Helper to send status to content script (disabled for cleaner console)
    function sendStatus(message) {
      // Status messages disabled to reduce console noise
      // Uncomment the line below if you need to debug
      // console.log('🎆 Fireworks [Background]:', message);
    }
    
    // Fast parallel download using Range requests for S3
    async function fastFetch(url, concurrency = 20, tabId = null, progressTracker = null) {
      sendStatus('Starting fast parallel fetch with ' + concurrency + ' connections');
      
      // Initialize progress tracker if not provided
      if (!progressTracker) {
        progressTracker = {
          startTime: Date.now(),
          lastLoaded: 0,
          lastTime: Date.now(),
          totalBytes: 0
        };
      }
      
      // 1. Try to get file size with HEAD request (may fail for signed URLs)
      let totalBytes = 0;
      let supportsRange = false;
      let isCompressed = false;
      
      try {
        sendStatus('Attempting HEAD request...');
        const headResponse = await fetch(url, {
          method: 'HEAD',
          priority: 'high',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        });
        
        sendStatus('HEAD response status: ' + headResponse.status);
        
        if (headResponse.ok) {
          // Check compression
          const contentEncoding = headResponse.headers.get('content-encoding');
          isCompressed = contentEncoding && (contentEncoding.includes('gzip') || contentEncoding.includes('br') || contentEncoding.includes('deflate'));
          
          totalBytes = parseInt(headResponse.headers.get('content-length') || '0');
          supportsRange = headResponse.headers.get('accept-ranges') === 'bytes';
          sendStatus('HEAD success - File size: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB, Range supported: ' + supportsRange);
        } else {
          sendStatus('HEAD request failed: ' + headResponse.status + ' - will try Range request directly');
        }
      } catch (error) {
        sendStatus('HEAD request error (may not be supported for signed URLs): ' + error.message);
        // Continue - we'll try Range requests anyway
      }
      
      // If we don't have size or Range not supported, try to get size from first Range request
      // IMPORTANT: Do this BEFORE checking file size, so we can get the actual size even if HEAD failed
      if (!totalBytes || !supportsRange) {
        // Try a small Range request to get the content-length
        sendStatus('Testing Range request support...');
        try {
          const testResponse = await fetch(url, {
            method: 'GET',
            priority: 'high',
            credentials: 'include',
            headers: {
              'Range': 'bytes=0-1023', // Request first 1KB
              'Accept': 'application/json',
              'Accept-Encoding': 'gzip, deflate, br'
            }
          });
          
          sendStatus('Range test response status: ' + testResponse.status);
          
          if (testResponse.status === 206) {
            // Partial content - Range is supported!
            const contentRange = testResponse.headers.get('content-range');
            if (contentRange) {
              const match = contentRange.match(/\/(\d+)/);
              if (match) {
                totalBytes = parseInt(match[1], 10);
                supportsRange = true;
                sendStatus('✅ Got file size from Range request: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB - Range IS supported!');
              } else {
                sendStatus('Could not parse Content-Range: ' + contentRange);
              }
            }
          } else if (testResponse.status === 200) {
            sendStatus('Range request returned 200 (full file), Range may not be supported');
            // Get size from response
            totalBytes = parseInt(testResponse.headers.get('content-length') || '0');
            if (totalBytes > 0) {
              sendStatus('Got file size from response: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB');
            }
          } else {
            sendStatus('Range test returned unexpected status: ' + testResponse.status);
          }
        } catch (error) {
          sendStatus('Range test failed: ' + error.message);
        }
      }
      
      sendStatus('Final decision - totalBytes: ' + totalBytes + ' (' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB), supportsRange: ' + supportsRange);
      
      // If Range not supported, use single connection
      if (!supportsRange) {
        sendStatus('Using single connection (Range requests not supported by server)');
        const response = await fetch(url, {
          method: 'GET',
          priority: 'high',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.arrayBuffer();
      }
      
      // For small files, use single fetch with progress tracking
      // Lowered threshold to 1MB to enable parallel downloads for more files
      if (!totalBytes || totalBytes < 1 * 1024 * 1024) {
        sendStatus('Using single connection (file too small: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB)');
        const response = await fetch(url, {
          method: 'GET',
          priority: 'high',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        // Get size from response if not known
        if (!totalBytes) {
          totalBytes = parseInt(response.headers.get('content-length') || '0');
        }
        
        progressTracker.totalBytes = totalBytes;
        
        // Track progress for single connection
        const reader = response.body.getReader();
        const chunks = [];
        let receivedLength = 0;
        const progressInterval = setInterval(() => {
          if (!tabId || !totalBytes) return;
          
          const currentTime = Date.now();
          const timeDelta = (currentTime - progressTracker.lastTime) / 1000;
          const bytesDelta = receivedLength - progressTracker.lastLoaded;
          
          let speed = 0;
          let timeRemaining = 0;
          
          // Calculate speed only if enough time has passed and we have data
          if (timeDelta > 0.05 && bytesDelta > 0) {
            speed = bytesDelta / timeDelta;
            const remaining = totalBytes - receivedLength;
            timeRemaining = speed > 0 ? remaining / speed : 0;
          } else if (progressTracker.lastLoaded > 0 && receivedLength > progressTracker.lastLoaded) {
            // Fallback: estimate speed from total progress
            const totalTime = (currentTime - progressTracker.startTime) / 1000;
            if (totalTime > 0.1) {
              speed = receivedLength / totalTime;
              const remaining = totalBytes - receivedLength;
              timeRemaining = speed > 0 ? remaining / speed : 0;
            }
          }
          
          const progress = totalBytes > 0 ? Math.min((receivedLength / totalBytes) * 100, 100) : 0;
          
          try {
            chrome.tabs.sendMessage(tabId, {
              type: 'DOWNLOAD_PROGRESS',
              progress: progress,
              loaded: receivedLength,
              total: totalBytes,
              speed: speed,
              timeRemaining: timeRemaining
            }, () => {});
          } catch (err) {
            // Ignore
          }
          
          progressTracker.lastLoaded = receivedLength;
          progressTracker.lastTime = currentTime;
        }, 100);
        
        // Read the stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          chunks.push(value);
          receivedLength += value.length;
        }
        
        clearInterval(progressInterval);
        
        // Combine chunks
        const result = new Uint8Array(receivedLength);
        let position = 0;
        for (const chunk of chunks) {
          result.set(chunk, position);
          position += chunk.length;
        }
        
        return result.buffer;
      }
      
      // 2. Calculate chunks for parallel download
      const chunkSize = Math.ceil(totalBytes / concurrency);
      const promises = [];
      const chunkProgress = new Array(concurrency).fill(0);
      const chunkSpeeds = new Array(concurrency).fill(0); // Track speed per chunk
      const chunkLastLoaded = new Array(concurrency).fill(0); // Track last loaded per chunk
      const chunkLastTime = new Array(concurrency).fill(Date.now()); // Track last time per chunk
      
      sendStatus('✅ PARALLEL DOWNLOAD ENABLED!');
      sendStatus('Splitting into ' + concurrency + ' chunks of ~' + (chunkSize / 1024 / 1024).toFixed(2) + ' MB each');
      sendStatus('Total file size: ' + (totalBytes / 1024 / 1024).toFixed(2) + ' MB');
      
      // Store total bytes in tracker
      progressTracker.totalBytes = totalBytes;
      
      // 3. Start progress tracking
      const progressInterval = setInterval(() => {
        if (!tabId) return;
        
        const currentTime = Date.now();
        const totalLoaded = chunkProgress.reduce((sum, val) => sum + val, 0);
        
        // Only send update if we have new data
        if (totalLoaded <= progressTracker.lastLoaded) {
          return; // No new data, skip update
        }
        
        // Calculate speed for each chunk and sum them up (estimated sum of 10 connections)
        let totalSpeed = 0;
        for (let i = 0; i < concurrency; i++) {
          const chunkBytesDelta = chunkProgress[i] - chunkLastLoaded[i];
          const chunkTimeDelta = (currentTime - chunkLastTime[i]) / 1000;
          
          if (chunkTimeDelta > 0.05 && chunkBytesDelta > 0) {
            // Calculate speed for this chunk
            const chunkSpeed = chunkBytesDelta / chunkTimeDelta;
            chunkSpeeds[i] = chunkSpeed;
            totalSpeed += chunkSpeed;
            
            // Update chunk tracking
            chunkLastLoaded[i] = chunkProgress[i];
            chunkLastTime[i] = currentTime;
          } else if (chunkSpeeds[i] > 0 && chunkProgress[i] > chunkLastLoaded[i]) {
            // Use last known speed for this chunk if it's still active
            totalSpeed += chunkSpeeds[i];
          }
        }
        
        // Fallback: if no chunk speeds available, use overall progress
        if (totalSpeed === 0) {
          const timeDelta = (currentTime - progressTracker.lastTime) / 1000;
          const bytesDelta = totalLoaded - progressTracker.lastLoaded;
          
          if (timeDelta > 0.05 && bytesDelta > 0) {
            totalSpeed = bytesDelta / timeDelta;
          } else {
            // Use total time as fallback
            const totalTime = (currentTime - progressTracker.startTime) / 1000;
            if (totalTime > 0.1 && totalLoaded > 0) {
              totalSpeed = totalLoaded / totalTime;
            }
          }
        }
        
        const remaining = totalBytes - totalLoaded;
        const timeRemaining = totalSpeed > 0 ? remaining / totalSpeed : 0;
        const progress = Math.min((totalLoaded / totalBytes) * 100, 100);
        
        try {
          chrome.tabs.sendMessage(tabId, {
            type: 'DOWNLOAD_PROGRESS',
            progress: progress,
            loaded: totalLoaded,
            total: totalBytes,
            speed: totalSpeed,
            timeRemaining: timeRemaining
          }, () => {
            if (chrome.runtime.lastError) {
              // Tab might not be ready, ignore
            }
          });
        } catch (err) {
          // Ignore errors
        }
        
        progressTracker.lastLoaded = totalLoaded;
        progressTracker.lastTime = currentTime;
      }, 100); // Update every 100ms
      
      // 4. Fetch chunks in parallel
      for (let i = 0; i < concurrency; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize - 1, totalBytes - 1);
        
        const chunkPromise = fetch(url, {
          method: 'GET',
          priority: 'high',
          credentials: 'include',
          headers: {
            'Range': `bytes=${start}-${end}`,
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        }).then(async (response) => {
          if (response.status !== 206 && response.status !== 200) {
            throw new Error(`HTTP ${response.status}: Range request failed`);
          }
          
          // Track progress for this chunk
          const reader = response.body.getReader();
          const chunks = [];
          let received = 0;
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            received += value.length;
            chunkProgress[i] = received;
          }
          
          // Combine chunk data
          const chunkBuffer = new Uint8Array(received);
          let position = 0;
          for (const chunk of chunks) {
            chunkBuffer.set(chunk, position);
            position += chunk.length;
          }
          
          return { index: i, data: chunkBuffer };
        }).catch((error) => {
          console.error(`🎆 Fireworks [Background]: Chunk ${i} failed:`, error);
          throw error; // Re-throw to fail the whole operation
        });
        
        promises.push(chunkPromise);
      }
      
      // 5. Wait for all chunks and merge
      try {
        const results = await Promise.all(promises);
        clearInterval(progressInterval);
        
        // Sort by index to maintain order
        results.sort((a, b) => a.index - b.index);
        
        // Merge chunks
        const result = new Uint8Array(totalBytes);
        let position = 0;
        for (const { data } of results) {
          result.set(data, position);
          position += data.length;
        }
        
        return result.buffer;
      } catch (error) {
        clearInterval(progressInterval);
        console.error('🎆 Fireworks [Background]: Parallel download failed, falling back to single connection:', error);
        
        // Fallback to single connection
        const response = await fetch(url, {
          method: 'GET',
          priority: 'high',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Accept-Encoding': 'gzip, deflate, br'
          }
        });
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return await response.arrayBuffer();
      }
    }
    
    // Track progress - these need to be accessible to fastFetch
    let progressTracker = {
      startTime: Date.now(),
      lastLoaded: 0,
      lastTime: Date.now(),
      totalBytes: 0
    };
    
    // Send initial progress
    if (tabId) {
      try {
        chrome.tabs.sendMessage(tabId, {
          type: 'DOWNLOAD_PROGRESS',
          progress: 0,
          loaded: 0,
          total: 0,
          speed: 0,
          timeRemaining: 0
        }, () => {});
      } catch (err) {
        // Ignore
      }
    }
    
    // Get connections from request (user setting) or use default
    const connections = request.connections || 20;
    
    // Execute fast fetch
    fastFetch(request.url, connections, tabId, progressTracker)
      .then(async (arrayBuffer) => {
        // Check file type before parsing
        const urlLower = request.url.toLowerCase();
        const isPdf = urlLower.includes('.pdf') || 
                      urlLower.endsWith('/pdf') ||
                      (arrayBuffer.byteLength > 4 && 
                       new Uint8Array(arrayBuffer).slice(0, 4).join('') === '25504446'); // PDF magic number "%PDF"
        
        if (isPdf) {
          console.error('🎆 Fireworks [Background]: File is a PDF, not a notebook');
          try {
            sendResponse({ 
              success: false, 
              error: 'This file is a PDF, not a Jupyter notebook. Please download the .ipynb file directly instead.' 
            });
          } catch (e) {
            console.error('🎆 Fireworks [Background]: Error sending error response:', e);
          }
          return;
        }
        
        // Check if it's actually JSON (notebook format)
        const text = new TextDecoder().decode(arrayBuffer);
        const trimmedText = text.trim();
        
        // Check if it starts with JSON-like content
        if (!trimmedText.startsWith('{') && !trimmedText.startsWith('[')) {
          console.error('🎆 Fireworks [Background]: File does not appear to be JSON');
          try {
            sendResponse({ 
              success: false, 
              error: 'File does not appear to be a valid Jupyter notebook. It may be a PDF or other file type. Please download the .ipynb file directly.' 
            });
          } catch (e) {
            console.error('🎆 Fireworks [Background]: Error sending error response:', e);
          }
          return;
        }
        
        try {
          const data = JSON.parse(text);
          
          // Validate it's actually a notebook structure
          if (!data.cells && !data.nbformat) {
            console.error('🎆 Fireworks [Background]: JSON does not appear to be a notebook');
            try {
              sendResponse({ 
                success: false, 
                error: 'File is JSON but does not appear to be a valid Jupyter notebook format.' 
              });
            } catch (e) {
              console.error('🎆 Fireworks [Background]: Error sending error response:', e);
            }
            return;
          }
          
          // Send final progress update
          if (tabId) {
            try {
              chrome.tabs.sendMessage(tabId, {
                type: 'DOWNLOAD_PROGRESS',
                progress: 100,
                loaded: arrayBuffer.byteLength,
                total: arrayBuffer.byteLength,
                speed: 0,
                timeRemaining: 0
              }, () => {});
            } catch (err) {
              // Ignore
            }
          }
          
          try {
            sendResponse({ success: true, notebook: data });
          } catch (e) {
            console.error('🎆 Fireworks [Background]: Error sending response:', e);
          }
        } catch (error) {
          console.error('🎆 Fireworks [Background]: Error parsing JSON:', error);
          // Check if it might be a PDF or other binary format
          const firstBytes = new Uint8Array(arrayBuffer).slice(0, 100);
          const firstChars = String.fromCharCode.apply(null, Array.from(firstBytes));
          const mightBePdf = firstChars.includes('%PDF');
          
          let errorMsg = 'Failed to parse notebook data';
          if (mightBePdf) {
            errorMsg = 'This file appears to be a PDF, not a Jupyter notebook. Please download the .ipynb file directly instead.';
          } else if (error.message.includes('JSON')) {
            errorMsg = 'File is not valid JSON. It may be a PDF or other file type. Please download the .ipynb file directly.';
          }
          
          try {
            sendResponse({ success: false, error: errorMsg });
          } catch (e) {
            console.error('🎆 Fireworks [Background]: Error sending error response:', e);
          }
        }
      })
      .catch(error => {
        console.error('🎆 Fireworks [Background]: Fetch error:', error);
        try {
          sendResponse({ success: false, error: error.message || 'Network error occurred' });
        } catch (e) {
          console.error('🎆 Fireworks [Background]: Error sending response:', e);
        }
      });
    
    // Return true to indicate we'll send a response asynchronously
    return true;
  }
});

