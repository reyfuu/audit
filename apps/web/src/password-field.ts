/**
 * Input kata sandi dengan tombol lihat/sembunyi.
 *
 * Dipisah ke berkas sendiri karena dipakai di tiga tempat: halaman masuk, dan
 * dua kolom pada penggantian kata sandi. Menyalinnya berulang kali akan membuat
 * ketiganya perlahan berbeda perilaku.
 *
 * Keputusan penting: tombolnya ditambahkan oleh JavaScript, bukan ditulis di
 * HTML. Tanpa JS tombol itu tidak akan berfungsi sama sekali, dan tombol mati
 * yang terlihat hidup lebih buruk daripada tidak ada tombol. Dengan cara ini,
 * peramban tanpa JS tetap mendapat kolom kata sandi biasa yang berfungsi penuh.
 */
import { ICONS } from './icons'
import { esc } from './shell'

export interface PasswordFieldOpts {
  id: string
  name: string
  label: string
  /** `current-password` saat masuk, `new-password` saat mengganti. */
  autocomplete?: string
  required?: boolean
  minlength?: number
  placeholder?: string
  /** Keterangan kecil di bawah kolom. */
  hint?: string
}

export function passwordField(o: PasswordFieldOpts): string {
  return `<label class="lbl" for="${esc(o.id)}">${esc(o.label)}</label>
<div class="password-wrap">
  <input class="field" id="${esc(o.id)}" name="${esc(o.name)}" type="password"
         ${o.required ? 'required' : ''}
         ${o.minlength ? `minlength="${o.minlength}"` : ''}
         autocomplete="${esc(o.autocomplete ?? 'current-password')}"
         ${o.placeholder ? `placeholder="${esc(o.placeholder)}"` : ''}>
</div>
${o.hint ? `<p class="muted" style="margin:-6px 0 12px;font-size:13px">${esc(o.hint)}</p>` : ''}`
}

/**
 * Skrip yang memasang tombol lihat/sembunyi pada setiap kolom kata sandi.
 *
 * Ditulis sebagai satu skrip untuk seluruh halaman, sehingga jumlah kolom tidak
 * mengubah apa pun. Status diumumkan lewat `aria-pressed` dan label yang
 * berubah, supaya pembaca layar juga tahu kata sandinya sedang terlihat.
 */
export const PASSWORD_SCRIPT = `
(function () {
  var MATA = ${JSON.stringify(ICONS.lihat)};
  var CORET = ${JSON.stringify(ICONS.sembunyi)};
  var kolom = document.querySelectorAll('.password-wrap input[type="password"]');
  Array.prototype.forEach.call(kolom, function (input) {
    var tombol = document.createElement('button');
    tombol.type = 'button';
    tombol.className = 'password-toggle';
    tombol.setAttribute('aria-pressed', 'false');
    tombol.setAttribute('aria-label', 'Tampilkan kata sandi');
    tombol.title = 'Tampilkan kata sandi';
    tombol.innerHTML = MATA;
    tombol.addEventListener('click', function () {
      var terlihat = input.type === 'text';
      input.type = terlihat ? 'password' : 'text';
      tombol.innerHTML = terlihat ? MATA : CORET;
      var teks = terlihat ? 'Tampilkan kata sandi' : 'Sembunyikan kata sandi';
      tombol.setAttribute('aria-pressed', terlihat ? 'false' : 'true');
      tombol.setAttribute('aria-label', teks);
      tombol.title = teks;
      // Kursor dikembalikan ke akhir teks; tanpa ini sebagian peramban
      // memindahkannya ke awal saat tipe input berubah.
      if (input.setSelectionRange) {
        var n = input.value.length;
        input.focus();
        try { input.setSelectionRange(n, n); } catch (e) {}
      }
    });
    input.parentNode.appendChild(tombol);
    input.classList.add('has-toggle');
  });
})();`
