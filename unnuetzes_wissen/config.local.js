// Nur in der eigenen Version: Verknüpfung mit der Insta-Map im übergeordneten Ordner.
Object.assign(window.UW_CONFIG, {
  instaMapUrl: "../"
});
// Reiseroute der Insta-Map (window.TRIP): Die App weiß damit auch ohne GPS, wo du heute bist,
// und bietet am Vorabend Fakten zur nächsten Station an.
document.write('<script src="../data/trip.js"><\/script>');
