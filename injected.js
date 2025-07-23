// Injected script to access Instagram's internal APIs
(function() {
    'use strict';
    
    // Helper to intercept Instagram's GraphQL requests
    window.instagramHelper = {
        // Store original fetch function
        originalFetch: window.fetch,
        
        // Initialize interception
        init: function() {
            const self = this;
            window.fetch = function(...args) {
                const url = args[0];
                
                // Intercept GraphQL requests for followers/following
                if (typeof url === 'string' && url.includes('graphql')) {
                    return self.originalFetch.apply(this, args).then(response => {
                        // Clone response to avoid consuming it
                        const clonedResponse = response.clone();
                        
                        // Check if this is a followers/following request
                        if (url.includes('edge_followed_by') || url.includes('edge_follow')) {
                            clonedResponse.json().then(data => {
                                // Emit event with data
                                window.dispatchEvent(new CustomEvent('instagramData', {
                                    detail: { url, data }
                                }));
                            }).catch(() => {});
                        }
                        
                        return response;
                    });
                }
                
                return self.originalFetch.apply(this, args);
            };
        },
        
        // Get user ID from page
        getUserId: function() {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent;
                if (content.includes('"profilePage_')) {
                    const match = content.match(/"profilePage_(\d+)"/);
                    if (match) return match[1];
                }
            }
            return null;
        },
        
        // Extract shared data
        getSharedData: function() {
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const content = script.textContent;
                if (content.includes('window._sharedData')) {
                    try {
                        const match = content.match(/window\._sharedData\s*=\s*({.+?});/);
                        if (match) {
                            return JSON.parse(match[1]);
                        }
                    } catch (e) {
                        continue;
                    }
                }
            }
            return null;
        }
    };
    
    // Initialize the helper
    window.instagramHelper.init();
    
    // Listen for data events
    window.addEventListener('instagramData', function(event) {
        // Forward to content script
        window.postMessage({
            type: 'INSTAGRAM_DATA',
            data: event.detail
        }, '*');
    });
    
})();