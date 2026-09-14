<p align="center"> <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white" alt="Python 3.10+"></a> <img src="https://img.shields.io/badge/Cloudflare-F38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers and R2"> <img src="https://img.shields.io/badge/Claude-D97757?logo=anthropic&logoColor=white" alt="Claude"> <a href=".github/workflows/deploy.yml"><img src="https://github.com/nadiaenh/sprightly/actions/workflows/deploy.yml/badge.svg" alt="Deploy"></a> <a href=".github/workflows/integration.yml"><img src="https://github.com/nadiaenh/sprightly/actions/workflows/integration.yml/badge.svg" alt="Integration"></a> </p>

**sprightly** is a lightweight service that generates animated pixel art GIF's from a short prompt. The service runs on Cloudflare Workers and the images are saved to Cloudflare R2.

<p align="center"><img src="examples/fairy.gif" alt="A pixel art fairy" width="256"></p>

## Setup

**Don't forget to enable R2** in your Cloudflare dashboard !

```sh
git clone git@github.com:nadiaenh/sprightly.git
cd sprightly
./setup.sh
```

## Usage

```sh
set -a && source .env && set +a          
python3 main.py "a walking cat"
```

## Demo

Image generation takes ~1min and costs ~$0.30 on average.

### v1

4-frame animations, one-shot only.

<img src="examples/cat-2.gif" alt="sprightly output: an orange frog" width="128"> <img src="https://pub-04c53b629290498c9ca208af58491e0b.r2.dev/5fa3dd05-e712-4306-aadf-530e56ce6b33.gif" alt="sprightly output: an orange frog" width="128"> <img src="https://pub-04c53b629290498c9ca208af58491e0b.r2.dev/0d862be8-7343-4495-8630-1c91171232c6.gif" alt="sprightly output: a green fox looking up and down" width="128"> <img src="examples/fire.gif" alt="sprightly output: a green fox looking up and down" width="128">

### v2

8-frame animations, up to 3 attempts using visual verification.

<img src="examples/lantern.gif" alt="sprightly output: a lantern" width="128"> <img src="examples/threadmill.gif" alt="sprightly output: a snake" width="128"> <img src="examples/sockpuppet.gif" alt="sprightly output: a sock puppet" width="128"> <img src="examples/cinders.gif" alt="sprightly output: cinderella" width="128"> <img src="examples/fairy.gif" alt="sprightly output: a fairy" width="128"> <img src="examples/furnace.gif" alt="sprightly output: a furnace" width="128"> <img src="examples/headwind.gif" alt="sprightly output: a wind rotater" width="128">

<p>"a orange dog walking" on Sep 14, 2026 by claude-opus-5 (0m42s, $0.19)</p>
<p><img src="https://pub-04c53b629290498c9ca208af58491e0b.r2.dev/66cd4e21-d995-4349-ba0c-912d9841b132.gif" alt="sprightly output: a orange dog walking" width="128"></p>
