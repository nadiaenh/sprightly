<p align="center"> <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white" alt="Python 3.10+"></a> <img src="https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers and R2"> <img src="https://img.shields.io/badge/Claude-D97757?logo=anthropic&logoColor=white" alt="Claude"> <a href=".github/workflows/deploy.yml"><img src="https://github.com/nadiaenh/sprightly/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a> <a href=".github/workflows/integration.yml"><img src="https://github.com/nadiaenh/sprightly/actions/workflows/integration.yml/badge.svg" alt="Integration"></a> </p>

**sprightly** turns a short prompt into an animated pixel-art GIF. Claude returns a *drawing program* (ellipses, triangles, thick lines and beziers), which is executed onto a 32x32 canvas, outlined by dilating the silhouette, and assembled into a looping sprite animation. Deployed as a Cloudflare Worker that stores GIFs in R2 and hands back a public URL.

<p align="center"><img src="assets/cat.gif" alt="A pixel art cat walking" width="256"></p>

## Setup

Requires macOS with [Homebrew](https://brew.sh), a Cloudflare account, and an Anthropic API key. `setup.sh` installs Node, pnpm and Python for you.

**Enable R2 first.** In the Cloudflare dashboard, go to R2 and enable it (this requires adding a payment method even though the free tier covers this project at $0). Bucket creation fails with `code: 10042` until you do.

```sh
git clone https://github.com/nadiaenh/sprightly.git
cd sprightly
./setup.sh
```

`setup.sh` does the rest end to end: installs deps, logs into Cloudflare, creates the R2 bucket, stores your keys as worker secrets, deploys, and pushes the GitHub Actions secrets. It only stops to ask for what it cannot look up, and never overwrites a key already in `.env` or a secret already set in GitHub.

The one manual step it prompts for: turn on public access for the `sprightly-gifs` bucket (R2 → sprightly-gifs → Settings → Public access → allow the `r2.dev` subdomain) and paste the resulting `https://pub-<hash>.r2.dev` URL. Without it the worker returns links that 404.

For CI it asks for a Cloudflare API token. Create a **custom** token with `Workers Scripts: Read+Write`, `Workers R2 Storage: Read+Write`, and `Account Settings: Read`. After setup, pushing to `main` redeploys.

## Usage

```sh
set -a && source .env && set +a          # setup.sh wrote the URL and key here

# Generate against the deployed worker - prints the public R2 URL.
python main.py "a walking cat"

# Or render locally instead, straight to a file.
ANTHROPIC_API_KEY=sk-ant-... python main.py "a flapping bird" bird.gif --local

# Re-render a saved drawing program, no API call.
python main.py examples/cat.json cat.gif --program

# Check the deployed worker end to end.
python tests/generate_sprite.py
```

## Demo

<p align="center"><img src="assets/cat.gif" alt="sprightly output: a walking cat" width="256"></p>
