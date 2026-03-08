// Yuanio PWA Service Worker — Web Push 通知
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : { title: "Yuanio", body: "新消息" };
  event.waitUntil(
    self.registration.showNotification(data.title || "Yuanio", {
      body: data.body || "",
      icon: data.icon || undefined,
      tag: data.tag || "yuanio",
      data: data.url || "/",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data || "/"));
});
