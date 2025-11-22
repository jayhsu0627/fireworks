# Installation Instructions

## Quick Start

1. **Open Chrome Extensions Page**
   - Navigate to `chrome://extensions/` in your Chrome browser
   - Or go to: Menu (⋮) → More Tools → Extensions

2. **Enable Developer Mode**
   - Toggle the "Developer mode" switch in the top-right corner

3. **Load the Extension**
   - Click the "Load unpacked" button
   - Select the `chrome-extension` folder (the one containing `manifest.json`)
   - The extension will appear in your extensions list

4. **Verify Installation**
   - You should see "Fireworks - Gradescope Large File Viewer" in your extensions
   - Make sure it's enabled (toggle should be blue/on)

5. **Test the Extension**
   - Go to any Gradescope assignment page
   - Look for the 🎆 Preview Notebook button
   - Click it to test the notebook viewer

## Troubleshooting

### Extension Not Appearing
- Make sure Developer mode is enabled
- Check that you selected the correct folder (should contain manifest.json)
- Refresh the extensions page

### Icons Missing
- The manifest references icon files in `images/` folder
- If icons are missing, the extension will still work but may show a default icon
- You can create placeholder icons or remove the icons section from manifest.json

### Extension Not Working on Gradescope
- Make sure you're on a Gradescope page (`gradescope.com`)
- Check the browser console (F12) for any errors
- Verify the extension is enabled in `chrome://extensions/`

### Permission Errors
- The extension needs permissions to access Gradescope and S3 (for notebook downloads)
- These are automatically requested when you load the extension
- If you see permission errors, try reloading the extension

## Updating the Extension

When you make changes to the code:

1. Go to `chrome://extensions/`
2. Find "Fireworks - Gradescope Large File Viewer"
3. Click the refresh/reload icon (🔄) next to the extension
4. The changes will be applied immediately

## Uninstalling

1. Go to `chrome://extensions/`
2. Find "Fireworks - Gradescope Large File Viewer"
3. Click "Remove"
4. Confirm removal

Note: Your settings (parallel connections, search keywords) are stored in Chrome's local storage and will be preserved if you reinstall.

