document.querySelectorAll('ytd-rich-item-renderer, ytd-video-renderer, ytd-grid-video-renderer').forEach(function(el) {
  var text = el.innerText || '';
  if (/scheduled|premieres|upcoming/i.test(text)) {
    console.log('--- SCHEDULED VIDEO ---');
    console.log('innerText snippet:', text.substring(0, 200));
    console.log('metadataText:', el.querySelectorAll('.ytContentMetadataViewModelMetadataText'));
    el.querySelectorAll('.ytContentMetadataViewModelMetadataText').forEach(function(s, i) {
      console.log('  text[' + i + ']:', JSON.stringify(s.textContent), 'parent:', s.parentElement);
    });
    console.log('metadata-line:', el.querySelector('#metadata-line'));
    console.log('inline-metadata:', el.querySelector('.inline-metadata-item'));
    console.log('video-meta-block:', el.querySelector('ytd-video-meta-block'));
  }
});
