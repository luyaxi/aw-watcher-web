"use strict";
const express = require('express');
const app = express();
const port = 5092; // 您可以选择任何未被占用的端口

// 用于存储页面内容的变量
let currentPageContent = "<html><body><h1>Hello, World!</h1></body></html>";

app.get('/pages/get', (req, res) => {
  res.send(currentPageContent);
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});




/*
 * This code uses event pages, a special webextension thingy documented here:
 * https://developer.chrome.com/extensions/event_pages
 */

var client = require("./client.js");
const diff = require('diff');

// Mininum guaranteed in chrome is 1min
var check_interval = 5;
var max_check_interval = 60;
var heartbeat_interval = 20;
var heartbeat_pulsetime = heartbeat_interval + max_check_interval;

function getCurrentTabs(callback) {
  // Query filter to be passed to chrome.tabs.query - see
  // https://developer.chrome.com/extensions/tabs#method-query
  var queryInfo = {
    active: true,
    currentWindow: true,
  };

  chrome.tabs.query(queryInfo, function (tabs) {
    // TODO: Won't necessarily work when code is run as a background plugin instead of as a popup
    // chrome.tabs.query invokes the callback with a list of tabs that match the
    // query. When the popup is opened, there is certainly a window and at least
    // one tab, so we can safely assume that |tabs| is a non-empty array.
    // A window can only have one active tab at a time, so the array consists of
    // exactly one tab.
    callback(tabs);
  });
}

var last_heartbeat_data = null;
var last_heartbeat_time = null;

function heartbeat(tab, tabCount) {
  //console.log(JSON.stringify(tab));
  var now = new Date();
  var data = {
    url: tab.url,
    title: tab.title,
    audible: tab.audible,
    incognito: tab.incognito,
    tabCount: tabCount,
    innerText: tab.innerText === null ? "" : tab.innerText,
    diffText: tab.diffText === null ? "": tab.diffText
  };
  // First heartbeat on startup
  if (last_heartbeat_time === null) {
    //console.log("aw-watcher-web: First");
    client.sendHeartbeat(now, data, heartbeat_pulsetime);
    last_heartbeat_data = data;
    last_heartbeat_time = now;
  }
  // Any tab data has changed, finish previous event and insert new event
  else if (JSON.stringify(last_heartbeat_data) != JSON.stringify(data)) {
    //console.log("aw-watcher-web: Change");
    client.sendHeartbeat(
      new Date(now - 1),
      last_heartbeat_data,
      heartbeat_pulsetime
    );
    client.sendHeartbeat(now, data, heartbeat_pulsetime);
    last_heartbeat_data = data;
    last_heartbeat_time = now;
  }
  // If heartbeat interval has been exceeded
  else if (
    new Date(last_heartbeat_time.getTime() + heartbeat_interval * 1000) < now
  ) {
    //console.log("aw-watcher-web: Update");
    client.sendHeartbeat(now, data, heartbeat_pulsetime);
    last_heartbeat_time = now;
  }
}

/*
 * Heartbeat alarm
 */

function createNextAlarm() {
  var when = Date.now() + check_interval * 1000;
  chrome.alarms.create("heartbeat", { when: when });
}
var last_alarm_url = null;
var last_alarm_tabtext = null;
function alarmListener(alarm) {
  if (alarm.name === "heartbeat") {
    getCurrentTabs(function (tabs) {
      if (tabs.length >= 1) {
        chrome.tabs.query({}, function (foundTabs) {
          console.log("Alarm Triggered.");
          chrome.tabs.sendMessage(tabs[0].id, { action: "getInnerText" },
           function (response) {
            console.log("Get InnerText.");
            // console.log(response);
            currentPageContent = response.innerText;
            if (last_alarm_url === tabs[0].url) {
              var difference = diff.diffChars(last_alarm_tabtext, response.innerText);
              
              var totalChangedChars = difference.reduce(function(acc, part) {
                if (part.added || part.removed) {
                  return acc + part.value.length;
                }
                return acc;
              }, 0);

              var diffPercentage = (totalChangedChars / last_alarm_tabtext.length) * 100;
              
              if (diffPercentage > 10) {
                tabs[0].innerText = response.innerText;
                last_alarm_tabtext = response.innerText;
              } else {
                console.log("Detecting page diff.");
                var diff_text = [];
                for (var i = 0; i < difference.length; i++) {
                  if (difference[i].added) {
                    diff_text.push({type: 'added', value: difference[i].value})
                  } else if (difference[i].removed) {
                    diff_text.push({type: 'removed', value: difference[i].value});
                  }
                }
                tabs[0].diffText = diff_text;
                console.log("Page Diff");
                console.log(diff_text);
              }

            } else {
              // console.log(response);
              tabs[0].innerText = response.innerText;
              last_alarm_tabtext = response.innerText;
            }

            last_alarm_url = tabs[0].url;
            heartbeat(tabs[0], foundTabs.length);

          });
          // heartbeat(tabs[0], foundTabs.length);
        });
      } else {
        //console.log("tabs had length < 0");
      }
      createNextAlarm();
    });
  }
}

function startAlarmListener() {
  chrome.alarms.onAlarm.addListener(alarmListener);
  createNextAlarm();
}

function stopAlarmListener() {
  chrome.alarms.onAlarm.removeListener(alarmListener);
}

/*
 * Heartbeat tab change
 */

function tabChangedListener(activeInfo) {
  chrome.tabs.get(activeInfo.tabId, function (tab) {
    chrome.tabs.query({}, function (foundTabs) {
      heartbeat(tab, foundTabs.length);
    });
  });
}

function startTabChangeListener() {
  chrome.tabs.onActivated.addListener(tabChangedListener);
}

function stopTabChangeListener() {
  chrome.tabs.onActivated.removeListener(tabChangedListener);
}

/*
 * Start/stop logic
 */

function startWatcher() {
  console.log("Starting watcher");
  client.setup();
  startAlarmListener();
  startTabChangeListener();
}

function stopWatcher() {
  console.log("Stopping watcher");
  stopAlarmListener();
  stopTabChangeListener();
}

/*
 * Listen for events from popup.js
 */

function popupRequestReceived(msg) {
  if (msg.enabled != undefined) {
    chrome.storage.local.set({ enabled: msg.enabled });
    if (msg.enabled) {
      startWatcher();
    } else {
      stopWatcher();
    }
  }
}

async function askConsentNeeded() {
  // Source for compatibility check: https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Build_a_cross_browser_extension#handling_api_differences
  try {
    if (typeof browser.runtime.getBrowserInfo != "function") {
      return false;
    }
  } catch (e) {
    return false;
  }
  let browserInfo = await browser.runtime.getBrowserInfo();
  if (browserInfo.name != "Firefox") {
    return false;
  }

  // Mozilla Addons doesn't allow bypassing the consent dialog through managed storage,
  // so it is hard-coded to be disabled (you need to fork and self-distribute if you want to use this).
  const supportEnterprisePolicy = false;
  if (supportEnterprisePolicy) {
    try {
      if (await browser.storage.managed.get("consentOfflineDataCollection")) {
        return false;
      }
    } catch (e) {
      console.error("managed storage error: ", e);
      return true;
    }
  }
  return true;
}

function getConsentThenStart() {
  // consentGiven is set in static/consent.js
  chrome.storage.local.get("consentGiven", (obj) => {
    if (obj.consentGiven === true) {
      startWatcher();
    } else {
      const url = chrome.runtime.getURL("../static/consent.html");
      chrome.windows.create({
        url,
        type: "popup",
        height: 550,
        width: 416,
      });
    }
  });
}

/*
 * Init
 */

function init() {
  chrome.storage.local.get("enabled", async function (obj) {
    // obj.enabled is undefined when the extension is first installed,
    // or if we need user consent, and they have yet to give it.
    if (obj.enabled == undefined) {
      if (await askConsentNeeded()) {
        getConsentThenStart();
      } else {
        // If we don't need consent, enable by default
        chrome.storage.local.set({ enabled: true });
        startWatcher();
      }
    } else if (obj.enabled) {
      startWatcher();
    }
  });
  // Listens to enables/disables by toggling the checkbox in the popup.
  chrome.runtime.onMessage.addListener(popupRequestReceived);
}

(function () {
  init();
})();
