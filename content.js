// Content script for Instagram Unfollower Tracker
let isScanning = false;

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'startScan') {
        if (!isScanning) {
            scanAccount();
        }
        sendResponse({ status: 'started' });
    }
});

async function scanAccount() {
    if (isScanning) return;
    isScanning = true;
    
    try {
        // Send progress update
        chrome.runtime.sendMessage({
            type: 'progress',
            percent: 10,
            message: 'Checking if logged in...'
        });
        
        // Check if user is logged in and on their profile
        const username = await getCurrentUsername();
        if (!username) {
            throw new Error('Please go to your Instagram profile page');
        }
        
        chrome.runtime.sendMessage({
            type: 'progress',
            percent: 20,
            message: 'Getting followers list...'
        });
        
        // Get followers and following lists
        const followers = await getFollowers(username);
        
        chrome.runtime.sendMessage({
            type: 'progress',
            percent: 60,
            message: 'Getting following list...'
        });
        
        const following = await getFollowing(username);
        
        chrome.runtime.sendMessage({
            type: 'progress',
            percent: 90,
            message: 'Analyzing data...'
        });
        
        // Find users who don't follow back
        const unfollowers = findUnfollowers(following, followers);
        
        chrome.runtime.sendMessage({
            type: 'complete',
            data: {
                followers: followers,
                following: following,
                unfollowers: unfollowers
            }
        });
        
    } catch (error) {
        chrome.runtime.sendMessage({
            type: 'complete',
            error: error.message
        });
    } finally {
        isScanning = false;
    }
}

async function getCurrentUsername() {
    // Try to get username from current page
    const usernameElement = document.querySelector('header h1, header h2, [data-testid="user-avatar"] + div span');
    if (usernameElement) {
        return usernameElement.textContent.trim();
    }
    
    // Alternative method: check URL
    const urlMatch = window.location.pathname.match(/^\/([^\/]+)\/?$/);
    if (urlMatch) {
        return urlMatch[1];
    }
    
    return null;
}

async function getFollowers(username) {
    return await getUserList(username, 'followers');
}

async function getFollowing(username) {
    return await getUserList(username, 'following');
}

async function getUserList(username, type) {
    // Click on followers/following link
    const linkSelector = type === 'followers' 
        ? 'a[href*="/followers/"]' 
        : 'a[href*="/following/"]';
    
    const link = document.querySelector(linkSelector);
    if (!link) {
        throw new Error(`Cannot find ${type} link. Make sure you're on your profile page.`);
    }
    
    link.click();
    
    // Wait for modal to open
    await sleep(300);
    
    const modal = document.querySelector('[role="dialog"]');
    if (!modal) {
        throw new Error(`Failed to open ${type} modal`);
    }
    
    // Find the correct scrollable container for Instagram's modal
    let scrollContainer = findScrollableContainer(modal);
    
    console.log('Found scroll container:', scrollContainer);
    
    // Auto-scroll and collect users
    const users = new Set(); // Use Set to avoid duplicates
    let previousUserCount = 0;
    let noNewUsersCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 100;
    
    while (noNewUsersCount < 5 && scrollAttempts < maxScrollAttempts) {
        scrollAttempts++;
        
        // Collect all visible user links
        const userLinks = modal.querySelectorAll('a[href^="/"][href*="/"]');
        let newUsersFound = 0;
        
        userLinks.forEach(link => {
            const href = link.getAttribute('href');
            // More precise regex to match Instagram usernames
            const usernameMatch = href.match(/^\/([a-zA-Z0-9._]+)\/?$/);
            
            if (usernameMatch && !href.includes('/p/') && !href.includes('/reel/') && !href.includes('/tv/')) {
                const username = usernameMatch[1];
                
                // Skip if we already have this user
                if (![...users].find(u => u.username === username)) {
                    const img = link.querySelector('img');
                    const textContent = link.textContent || '';
                    
                    // Try to find the full name - Instagram structure varies
                    let fullName = '';
                    const spans = link.querySelectorAll('span');
                    if (spans.length > 1) {
                        fullName = spans[1].textContent || '';
                    }
                    
                    users.add({
                        username: username,
                        full_name: fullName,
                        profile_pic_url: img ? img.src : ''
                    });
                    newUsersFound++;
                }
            }
        });
        
        const currentUserCount = users.size;
        
        // Check if we found new users
        if (currentUserCount === previousUserCount) {
            noNewUsersCount++;
        } else {
            noNewUsersCount = 0;
            previousUserCount = currentUserCount;
        }
        
        // Scroll down using multiple methods
        await scrollModalContent(scrollContainer, modal);
        
        // Wait for content to load
        await sleep(100);
        
        // Update progress
        const progressPercent = type === 'followers' 
            ? Math.min(20 + (currentUserCount / 30), 59)
            : Math.min(60 + (currentUserCount / 30), 89);
            
        chrome.runtime.sendMessage({
            type: 'progress',
            percent: progressPercent,
            message: `Loading ${type}... (${currentUserCount} found)`
        });
        
        // Extra attempt to load more if we think there might be more
        if (noNewUsersCount >= 3 && currentUserCount > 0) {
            console.log('Trying aggressive scroll...');
            await performAggressiveScroll(scrollContainer, modal);
            await sleep(200);
        }
    }
    
    console.log(`Finished collecting ${type}:`, users.size, 'users found');
    
    // Close modal
    const closeButton = modal.querySelector('[aria-label="Close"]') || 
                       modal.querySelector('button[type="button"]') ||
                       modal.querySelector('svg[aria-label="Close"]')?.closest('button');
    if (closeButton && typeof closeButton.click === 'function') {
        closeButton.click();
    } else if (closeButton) {
        // Fallback: trigger click event manually
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        closeButton.dispatchEvent(clickEvent);
    }
    
    await sleep(150);
    
    return Array.from(users);
}

// Find the correct scrollable container in Instagram's modal
function findScrollableContainer(modal) {
    // Try different selectors for Instagram's modal structure
    const selectors = [
        'div[style*="overflow-y: scroll"]',
        'div[style*="overflow: scroll"]', 
        'div[style*="overflow-y: auto"]',
        'div[style*="max-height"][style*="overflow"]',
        'div[style*="height: 400px"]',
        'div[style*="height: 356px"]',
        'div > div > div > div:last-child', // Common Instagram modal structure
        'div[role="dialog"] > div > div > div:nth-child(2)', // Alternative structure
    ];
    
    for (const selector of selectors) {
        const container = modal.querySelector(selector);
        if (container && container.scrollHeight > container.clientHeight) {
            console.log('Found scrollable container with selector:', selector);
            return container;
        }
    }
    
    // Fallback: find any div that has scrollable content
    const allDivs = modal.querySelectorAll('div');
    for (const div of allDivs) {
        if (div.scrollHeight > div.clientHeight && div.clientHeight > 200) {
            console.log('Found scrollable div as fallback');
            return div;
        }
    }
    
    console.log('Using modal as scroll container (fallback)');
    return modal;
}

// Improved scroll function specifically for Instagram modals
async function scrollModalContent(scrollContainer, modal) {
    const initialScrollTop = scrollContainer.scrollTop;
    const maxScrollTop = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    
    // Method 1: Smooth scroll to bottom
    scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: 'smooth'
    });
    
    await sleep(30);
    
    // Method 2: Incremental scrolling
    const currentScroll = scrollContainer.scrollTop;
    const scrollIncrement = scrollContainer.clientHeight * 0.8;
    scrollContainer.scrollTop = currentScroll + scrollIncrement;
    
    await sleep(50);
    
    // Method 3: Dispatch wheel events to trigger Instagram's lazy loading
    const wheelEvents = [
        new WheelEvent('wheel', { deltaY: 500, bubbles: true }),
        new WheelEvent('wheel', { deltaY: 800, bubbles: true }),
        new WheelEvent('wheel', { deltaY: 1000, bubbles: true })
    ];
    
    wheelEvents.forEach(event => {
        scrollContainer.dispatchEvent(event);
        modal.dispatchEvent(event);
    });
    
    await sleep(100);
    
    // Method 4: Direct scroll manipulation
    if (scrollContainer.scrollTop < maxScrollTop * 0.9) {
        scrollContainer.scrollTop = Math.min(scrollContainer.scrollTop + 800, maxScrollTop);
    }
    
    // Method 5: Trigger scroll event
    scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
}


function findUnfollowers(following, followers) {
    const followerUsernames = new Set(followers.map(f => f.username));
    return following.filter(user => !followerUsernames.has(user.username));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Advanced scrolling function with multiple strategies
async function performAdvancedScroll(scrollContainer, modal) {
    const strategies = [
        // Strategy 1: Scroll to bottom
        () => {
            scrollContainer.scrollTo({
                top: scrollContainer.scrollHeight,
                behavior: 'smooth'
            });
        },
        
        // Strategy 2: Progressive scrolling
        () => {
            const currentScroll = scrollContainer.scrollTop;
            const increment = scrollContainer.clientHeight * 0.8;
            scrollContainer.scrollTo({
                top: currentScroll + increment,
                behavior: 'smooth'
            });
        },
        
        // Strategy 3: Direct scrollHeight manipulation
        () => {
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
        },
        
        // Strategy 4: Try scrolling the modal itself
        () => {
            modal.scrollTo({
                top: modal.scrollHeight,
                behavior: 'smooth'
            });
        },
        
        // Strategy 5: Simulate wheel events
        () => {
            const wheelEvent = new WheelEvent('wheel', {
                deltaY: 500,
                bubbles: true,
                cancelable: true
            });
            scrollContainer.dispatchEvent(wheelEvent);
        }
    ];
    
    // Try each strategy
    for (let i = 0; i < strategies.length; i++) {
        try {
            strategies[i]();
            await sleep(100); // Small delay between strategies
        } catch (error) {
            console.warn(`Scroll strategy ${i + 1} failed:`, error);
        }
    }
}

// Aggressive scroll for final attempts
async function performAggressiveScroll(scrollContainer, modal) {
    console.log('Starting aggressive scroll...');
    
    // Store initial position
    const initialScrollTop = scrollContainer.scrollTop;
    const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;
    
    // Multiple aggressive scroll techniques
    const techniques = [
        () => {
            // Rapid fire scrolling
            for (let i = 0; i < 10; i++) {
                scrollContainer.scrollTop += 200;
            }
        },
        () => {
            // Force scroll to absolute bottom
            scrollContainer.scrollTop = scrollContainer.scrollHeight;
        },
        () => {
            // Simulate rapid mouse wheel
            for (let i = 0; i < 15; i++) {
                const wheelEvent = new WheelEvent('wheel', {
                    deltaY: 100 * (i + 1),
                    bubbles: true,
                    cancelable: true
                });
                scrollContainer.dispatchEvent(wheelEvent);
            }
        },
        () => {
            // Try Page Down key events
            const keyEvents = ['PageDown', 'End', 'ArrowDown'];
            keyEvents.forEach(key => {
                const event = new KeyboardEvent('keydown', {
                    key: key,
                    bubbles: true,
                    cancelable: true
                });
                scrollContainer.dispatchEvent(event);
                modal.dispatchEvent(event);
            });
        },
        () => {
            // Try touch events for mobile-like scrolling
            const touchStart = new TouchEvent('touchstart', {
                touches: [{ clientY: 100 }],
                bubbles: true
            });
            const touchMove = new TouchEvent('touchmove', {
                touches: [{ clientY: 500 }],
                bubbles: true
            });
            const touchEnd = new TouchEvent('touchend', { bubbles: true });
            
            scrollContainer.dispatchEvent(touchStart);
            scrollContainer.dispatchEvent(touchMove);
            scrollContainer.dispatchEvent(touchEnd);
        }
    ];
    
    // Execute all techniques with delays
    for (let i = 0; i < techniques.length; i++) {
        try {
            techniques[i]();
            await sleep(150);
            console.log(`Aggressive technique ${i + 1} completed. Scroll position:`, scrollContainer.scrollTop);
        } catch (error) {
            console.warn(`Aggressive scroll technique ${i + 1} failed:`, error);
        }
    }
    
    // Final position check
    console.log('Aggressive scroll completed. Final position:', scrollContainer.scrollTop, 'Max:', maxScroll);
}

// Inject helper script
const script = document.createElement('script');
script.src = chrome.runtime.getURL('injected.js');
document.head.appendChild(script);
