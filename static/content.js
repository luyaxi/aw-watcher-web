"use strict";
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
  if (request.action == "getInnerText") {
    let visibleText = getVisibleText(document.body);
    sendResponse({ innerText: visibleText });
  }
});

function getVisibleText(element) {
  let text = '';

  // Helper function to check if an element is at least 50% visible in the viewport
  function isElementAtLeastHalfVisible(el) {
      const rect = el.getBoundingClientRect();
      const windowHeight = window.innerHeight || document.documentElement.clientHeight;
      const windowWidth = window.innerWidth || document.documentElement.clientWidth;

      // Check if the element is in the viewport
      const inViewport = rect.top < windowHeight && rect.bottom > 0 && rect.left < windowWidth && rect.right > 0;

      if (!inViewport) {
          return false;
      }

      // Calculate the visible area
      const verticalVisible = Math.min(rect.bottom, windowHeight) - Math.max(rect.top, 0);
      const horizontalVisible = Math.min(rect.right, windowWidth) - Math.max(rect.left, 0);
      const visibleArea = verticalVisible * horizontalVisible;
      const totalArea = rect.width * rect.height;

      return visibleArea >= 0.5 * totalArea;
  }

  // Recursive function to traverse the DOM and collect text from elements that are at least 50% visible
  function collectTextFromVisibleElements(el) {
      if (isElementAtLeastHalfVisible(el)) {
          // If the element itself is at least 50% visible, get its text
          if (el.innerText){
            text += el.innerText + ' ';
          }
      } else {
          // Otherwise, recursively check its children
          Array.from(el.children).forEach(collectTextFromVisibleElements);
      }
  }

  collectTextFromVisibleElements(element);
  return text.trim();
}