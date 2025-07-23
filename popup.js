let unfollowersList = [];

document.addEventListener('DOMContentLoaded', function() {
    const scanBtn = document.getElementById('scanBtn');
    const exportBtn = document.getElementById('exportBtn');
    const status = document.getElementById('status');
    const progress = document.getElementById('progress');
    const progressBar = document.getElementById('progressBar');
    const results = document.getElementById('results');
    const stats = document.getElementById('stats');
    
    // Load saved data
    chrome.storage.local.get(['unfollowers', 'scanDate'], function(data) {
        if (data.unfollowers && data.scanDate) {
            const scanDate = new Date(data.scanDate);
            const now = new Date();
            const hoursDiff = (now - scanDate) / (1000 * 60 * 60);
            
            if (hoursDiff < 24) {
                displayResults(data.unfollowers);
                updateStatus(`Last scan: ${scanDate.toLocaleTimeString()}`, 'success');
            }
        }
    });
    
    scanBtn.addEventListener('click', function() {
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            const tab = tabs[0];
            
            if (!tab.url.includes('instagram.com')) {
                updateStatus('Please navigate to Instagram first', 'error');
                return;
            }
            
            startScan();
        });
    });
    
    exportBtn.addEventListener('click', function() {
        exportToCSV();
    });
    
    function startScan() {
        scanBtn.disabled = true;
        progress.style.display = 'block';
        updateStatus('Starting scan...', 'info');
        
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { action: 'startScan' }, function(response) {
                if (chrome.runtime.lastError) {
                    updateStatus('Error: Please refresh Instagram and try again', 'error');
                    scanBtn.disabled = false;
                    progress.style.display = 'none';
                    return;
                }
            });
        });
    }
    
    function updateStatus(message, type) {
        status.textContent = message;
        status.className = `status ${type}`;
    }
    
    function updateProgress(percent, message) {
        progressBar.style.width = percent + '%';
        if (message) {
            updateStatus(message, 'info');
        }
    }
    
    function displayResults(data) {
        unfollowersList = data.unfollowers;
        
        // Update stats
        document.getElementById('followingCount').textContent = data.following.length;
        document.getElementById('followersCount').textContent = data.followers.length;
        document.getElementById('unfollowersCount').textContent = unfollowersList.length;
        stats.style.display = 'flex';
        
        // Display unfollowers list
        results.innerHTML = '';
        
        if (unfollowersList.length === 0) {
            results.innerHTML = '<div style="text-align: center; color: #8e8e8e; padding: 20px;">Everyone you follow follows you back! 🎉</div>';
        } else {
            unfollowersList.forEach(user => {
                const userDiv = document.createElement('div');
                userDiv.className = 'user-item';
                userDiv.innerHTML = `
                    <img class="user-avatar" src="${user.profile_pic_url || ''}" alt="${user.username}" onerror="this.style.display='none'">
                    <div class="user-info">
                        <div class="username">@${user.username}</div>
                        <div class="fullname">${user.full_name || ''}</div>
                    </div>
                `;
                
                userDiv.addEventListener('click', function() {
                    chrome.tabs.create({ url: `https://instagram.com/${user.username}` });
                });
                
                results.appendChild(userDiv);
            });
        }
        
        exportBtn.style.display = unfollowersList.length > 0 ? 'block' : 'none';
    }
    
    function exportToCSV() {
        if (unfollowersList.length === 0) return;
        
        let csv = 'Username,Full Name,Profile URL\n';
        unfollowersList.forEach(user => {
            csv += `${user.username},"${user.full_name || ''}",https://instagram.com/${user.username}\n`;
        });
        
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        
        chrome.downloads.download({
            url: url,
            filename: `instagram_unfollowers_${new Date().toISOString().split('T')[0]}.csv`
        });
    }
    
    // Listen for messages from content script
    chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
        if (message.type === 'progress') {
            updateProgress(message.percent, message.message);
        } else if (message.type === 'complete') {
            scanBtn.disabled = false;
            progress.style.display = 'none';
            
            if (message.error) {
                updateStatus(message.error, 'error');
            } else {
                displayResults(message.data);
                updateStatus(`Scan complete! Found ${message.data.unfollowers.length} non-followers`, 'success');
                
                // Save data
                chrome.storage.local.set({
                    unfollowers: message.data,
                    scanDate: new Date().toISOString()
                });
            }
        }
    });
});