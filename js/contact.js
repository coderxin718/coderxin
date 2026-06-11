(function () {
  var form = document.getElementById('contact-form');
  var submitBtn = document.getElementById('submit-btn');
  var btnText = submitBtn.querySelector('.btn-text');
  var btnSpinner = submitBtn.querySelector('.btn-spinner');
  var feedback = document.getElementById('form-feedback');

  // ============================================================
  // 在这里粘贴你部署好的 Google Apps Script 网页应用 URL
  // 格式类似：https://script.google.com/macros/s/XXXXX/exec
  // 部署步骤见 apps-script.gs 文件
  // ============================================================
  var FORM_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzRAzHL-dq8Az9TVODv4LDEDdh3ElRt0VZsFMjp3SMAVG65I7XYHlLk_n4dY3olyvhV/exec';

  function clearErrors() {
    form.querySelectorAll('.form-error').forEach(function (el) { el.textContent = ''; });
    form.querySelectorAll('.input-error').forEach(function (el) { el.classList.remove('input-error'); });
  }

  function setError(fieldId, message) {
    var input = document.getElementById(fieldId);
    var errorEl = document.getElementById(fieldId + '-error');
    if (input) input.classList.add('input-error');
    if (errorEl) errorEl.textContent = message;
  }

  function validate() {
    clearErrors();
    var valid = true;

    var name = document.getElementById('name').value.trim();
    var email = document.getElementById('email').value.trim();
    var msg = document.getElementById('message').value.trim();

    if (!name) { setError('name', 'Please enter your name.'); valid = false; }
    if (!email) { setError('email', 'Please enter your email address.'); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('email', 'Please enter a valid email address.'); valid = false; }
    if (!msg) { setError('message', 'Please enter a message.'); valid = false; }

    return valid;
  }

  function setLoading(loading) {
    submitBtn.disabled = loading;
    btnText.hidden = loading;
    btnSpinner.classList.toggle('visible', loading);
    feedback.hidden = true;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    if (!validate()) return;

    setLoading(true);

    var payload = {
      name: document.getElementById('name').value.trim(),
      email: document.getElementById('email').value.trim(),
      message: document.getElementById('message').value.trim()
    };

    fetch(FORM_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify(payload)
    })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        if (data.success) {
          feedback.textContent = "Thanks! Your message has been sent. I'll get back to you soon.";
          feedback.className = 'form-feedback feedback-success';
          feedback.hidden = false;
          form.reset();
        } else {
          throw new Error(data.error || 'Submission failed.');
        }
      })
      .catch(function (err) {
        feedback.textContent = "Something went wrong. You can also email me directly at hello@alexrivera.com.";
        feedback.className = 'form-feedback feedback-error';
        feedback.hidden = false;
      })
      .finally(function () {
        setLoading(false);
      });
  });
})();
