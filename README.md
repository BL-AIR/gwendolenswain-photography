# gwendolenswain-photography

The website for **Gwendolen Swain Photography**, published at <https://gwendolen.com.au>.

It's a plain static site with no build step. GitHub Pages serves it straight from the `main` branch.

## Structure

| Path | What it is |
|---|---|
| `index.html` | Home |
| `work.html` | Portfolio, arranged as series. Each series has its own gallery. |
| `about.html` | About Gwendolen |
| `contact.html` | Contact details and the enquiry form. The form opens the visitor's own email app, so no server is needed. |
| `404.html` | Page shown when a page isn't found |
| `assets/css/tokens/` | Brand tokens copied unchanged from the Gwendolen Swain Photography design system |
| `assets/css/site.css` | Site styles, built on the tokens |
| `assets/img/logo/` | Logo SVG masters from the design system |
| `assets/js/site.js` | Lightbox for the galleries, the enquiry form, and the footer year |
| `images/portfolio/<series>/` | Portfolio photographs |
| `CNAME` | Custom domain for GitHub Pages |

## Adding photographs

Every gallery placeholder looks like this:

```html
<figure><div class="ph ph--portrait"></div></figure>
```

To add a photograph, replace the placeholder with:

```html
<figure>
  <a class="tile" href="images/portfolio/series-one/01-full.jpg">
    <img src="images/portfolio/series-one/01.jpg" alt="Describe the photograph" loading="lazy" width="1200" height="1500">
  </a>
  <figcaption>Title — Year</figcaption>
</figure>
```

- Make the gallery image (`01.jpg`) about 1200px on its long edge.
- Make the full-size image (`01-full.jpg`) about 2400px on its long edge, saved as JPEG at roughly 80% quality.
- Always write alt text that describes the photograph.

## Brand

Follow the design system README in the project folder. In short:

- Australian spelling.
- Gwendolen writes as "I" and speaks to the client as "you".
- Square corners everywhere. No shadows and no gradients.
- Ochre is used only for actions.
