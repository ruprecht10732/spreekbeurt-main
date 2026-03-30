import { ChangeDetectionStrategy, Component, HostListener, signal, computed, effect, ViewChild, ElementRef, AfterViewInit, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Background3DComponent } from './background-3d.component';
import { SLIDES } from './slides.data';
import { animate, stagger, cubicBezier } from 'motion';

type CelebrationType = 'answer' | 'finale';

interface CelebrationStar {
  x: number;
  y: number;
  r: number;
  alpha: number;
  decay: number;
  color: string;
  pulse: number;
}

interface CelebrationMeteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  alpha: number;
  decay: number;
  color: string;
  trail: Array<{ x: number; y: number }>;
}

interface CelebrationNova {
  x: number;
  y: number;
  r: number;
  maxR: number;
  alpha: number;
  color: string;
  ring: number;
}

interface CelebrationSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  alpha: number;
  decay: number;
  size: number;
  color: string;
}

interface CelebrationFrameState {
  width: number;
  height: number;
  frame: number;
  maxFrames: number;
  stars: CelebrationStar[];
  meteors: CelebrationMeteor[];
  novas: CelebrationNova[];
  sparks: CelebrationSpark[];
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [Background3DComponent, MatIconModule, DecimalPipe],
  template: `
    <!-- Background audio for entire presentation -->
    <audio #bgAudio [src]="bgAudioSrc" loop preload="auto" class="hidden"></audio>

    <!-- Space celebration canvas -->
    <canvas #celebrationCanvas class="fixed inset-0 w-full h-full z-[15] pointer-events-none" [class.hidden]="!celebrationActive()"></canvas>

    <!-- Full-screen video background (behind 3D, revealed on zoom) -->
    @if (currentSlide().video) {
      <video #bgVideo
        class="fixed inset-0 w-full h-full object-cover z-[1] transition-opacity duration-1000"
        [class.opacity-0]="!videoRevealed()"
        [src]="currentSlide().video"
        loop playsinline autoplay>
      </video>
      <!-- Video scrim overlay for readability -->
      @if (videoRevealed()) {
        <div class="fixed inset-0 z-[2] pointer-events-none video-scrim"></div>
      }
    }

    <app-background-3d 
      [slideIndex]="currentIndex()" 
      [slideId]="currentSlide().id"
      [fadeOut]="videoRevealed()"
      [tourMode]="tourMode()"
      (loaded)="onSceneLoaded()"
      (distanceKm)="onDistanceUpdate($event)"
      (tourPlanet)="onTourPlanet($event)"
      (telemetry)="telemetry.set($event)"
      (loadProgress)="loadingProgress.set($event)"
      class="transition-opacity duration-[2000ms] ease-in-out"
      [class.opacity-0]="videoRevealed()">
    </app-background-3d>

    <!-- SpaceX Telemetry HUD (Only visible during launch) -->
    @if (telemetry()) {
      <div class="fixed top-8 left-8 z-[25] pointer-events-none animate-fade-in flex flex-col gap-4">
        <!-- Status Badge -->
        <div class="bg-black/60 border border-white/20 backdrop-blur-md px-4 py-2 rounded-sm flex items-center gap-3">
          <div class="w-3 h-3 rounded-full animate-pulse"
               [class.bg-red-500]="telemetry()!.phase === 'MAX-Q'"
               [class.bg-yellow-500]="telemetry()!.phase === 'COAST'"
               [class.bg-green-500]="telemetry()!.phase === 'HOVERSLAM' || telemetry()!.phase === 'ENTRY BURN'">
          </div>
          <span class="font-mono text-sm tracking-widest text-white/90">FALCON 9 • {{ telemetry()!.phase }}</span>
        </div>

        <!-- Data Readouts -->
        <div class="flex gap-4">
          <div class="bg-black/40 border border-white/10 backdrop-blur-md p-4 rounded-sm min-w-[140px]">
            <div class="text-[10px] text-white/50 font-mono mb-1 tracking-widest">ALTITUDE</div>
            <div class="font-mono text-3xl text-white">{{ telemetry()!.altitude | number }} <span class="text-sm text-white/50">KM</span></div>
          </div>
          <div class="bg-black/40 border border-white/10 backdrop-blur-md p-4 rounded-sm min-w-[140px]">
            <div class="text-[10px] text-white/50 font-mono mb-1 tracking-widest">VELOCITY</div>
            <div class="font-mono text-3xl text-white">{{ telemetry()!.speed | number }} <span class="text-sm text-white/50">KM/H</span></div>
          </div>
        </div>
      </div>
    }

    <!-- Apollo 11 Nav Display (Only visible during Moon tour stop) -->
    @if (tourMode() && tourCurrentPlanet() === 'maan') {
      <div class="fixed top-8 right-8 z-[25] pointer-events-none animate-fade-in">
        <div class="bg-black/70 border border-amber-500/30 backdrop-blur-md p-5 rounded-sm font-mono min-w-[220px]">
          <div class="text-[10px] text-amber-400/60 tracking-[0.3em] mb-3">NAVIGATION • APOLLO 11</div>
          <div class="border-t border-amber-500/20 pt-3 space-y-3">
            <div>
              <div class="text-[9px] text-amber-400/50 tracking-widest">LANDING SITE</div>
              <div class="text-amber-400/90 text-sm mt-0.5">TRANQUILITY BASE</div>
            </div>
            <div class="flex gap-6">
              <div>
                <div class="text-[9px] text-amber-400/50 tracking-widest">LAT</div>
                <div class="text-amber-400 text-lg tabular-nums">0.67416°N</div>
              </div>
              <div>
                <div class="text-[9px] text-amber-400/50 tracking-widest">LON</div>
                <div class="text-amber-400 text-lg tabular-nums">23.47314°E</div>
              </div>
            </div>
            <div class="border-t border-amber-500/15 pt-2">
              <div class="text-[9px] text-amber-400/50 tracking-widest">MARE TRANQUILLITATIS</div>
              <div class="text-amber-400/70 text-[11px] mt-1">20 JULI 1969 • 20:17 UTC</div>
            </div>
          </div>
        </div>
      </div>
    }

    <div class="relative z-10 w-full h-screen overflow-hidden flex flex-col items-center justify-center pointer-events-none">
      
      <!-- Star Wars Crawl for Title Slide -->
      @if (currentSlide().isTitleSlide && !(currentSlide().id === 'afsluiting' && tourMode())) {
        <div class="absolute inset-0 flex items-center justify-center perspective-[800px]">
          <div #crawlContainer class="w-[80%] max-w-3xl text-center text-[var(--color-starwars-yellow)] font-starwars transform-gpu rotate-x-[20deg] origin-bottom transition-opacity duration-[3000ms]" [class.opacity-0]="tourMode()">
            <h1 class="text-7xl md:text-9xl mb-8 uppercase tracking-widest title-shimmer">{{ currentSlide().title }}</h1>
            @if (currentSlide().id === 'title') {
              <p class="text-sm md:text-xl mb-4 uppercase tracking-[0.5em] opacity-50 font-starwars">Gemaakt door</p>
              <div class="name-backdrop relative mb-6">
                @for (char of nameChars; track $index) {
                  <span class="name-char relative inline-block text-5xl md:text-8xl font-starwars uppercase"
                        [style.animation-delay]="($index * 120) + 'ms'"
                        [style.min-width]="char === ' ' ? '0.4em' : 'auto'">{{ char }}</span>
                }
              </div>
              <p class="text-lg md:text-2xl uppercase tracking-wider opacity-45 name-subtitle">Klas: Groep 7</p>
            } @else {
              @for (line of currentSlide().content; track $index) {
                <p class="text-3xl md:text-5xl mb-4 uppercase tracking-wider">{{ line }}</p>
              }
            }
            @if (currentSlide().id === 'title' && !hasStarted()) {
              @if (sceneLoaded()) {
                <button (click)="startPresentation()" class="mt-12 pointer-events-auto group flex flex-col items-center gap-4 mx-auto focus:outline-none">
                  <div class="w-28 h-28 rounded-full bg-[var(--color-starwars-yellow)]/20 border-2 border-[var(--color-starwars-yellow)] flex items-center justify-center group-hover:bg-[var(--color-starwars-yellow)]/40 group-hover:scale-110 active:scale-95 transition-all duration-300 shadow-[0_0_40px_rgba(255,232,31,0.3)] group-hover:shadow-[0_0_60px_rgba(255,232,31,0.5)] play-pulse">
                    <mat-icon class="!text-6xl !w-14 !h-14 text-[var(--color-starwars-yellow)] ml-1" style="font-size:56px;width:56px;height:56px;">play_arrow</mat-icon>
                  </div>
                  <span class="text-xl opacity-70 group-hover:opacity-100 transition-opacity">Klik om te beginnen</span>
                </button>
              } @else {
                <div class="mt-12 flex flex-col items-center gap-4 w-64 mx-auto">
                  <div class="text-xs font-mono tracking-[0.3em] text-[var(--color-starwars-yellow)]/70">INITIALIZING SYSTEMS</div>
                  <div class="w-full h-1 bg-white/10 rounded-full overflow-hidden">
                    <div class="h-full bg-[var(--color-starwars-yellow)] transition-all duration-300 ease-out shadow-[0_0_10px_rgba(255,232,31,0.5)]"
                         [style.width.%]="loadingProgress()"></div>
                  </div>
                  <span class="text-xs font-mono text-white/50">{{ loadingProgress() | number:'1.0-0' }}%</span>
                </div>
              }
            } @else if (currentSlide().id === 'title' && hasStarted()) {
              <p class="mt-12 text-xl opacity-70 animate-pulse">Druk op spatie of pijltje naar rechts om verder te gaan</p>
            }
          </div>
        </div>
      } @else {
        <!-- Gradient overlays for text readability -->
        <div class="absolute inset-0 pointer-events-none" [class]="videoRevealed() ? 'video-readability-overlay' : ''">
          <div class="absolute inset-0 bg-gradient-to-r from-black/70 via-black/25 to-transparent"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/25"></div>
        </div>

           <div #slideContainer
             class="relative w-full h-full pointer-events-auto transition-opacity duration-[1800ms]"
             [class.opacity-0]="currentSlide().id === 'afsluiting' && tourMode()"
             [class.pointer-events-none]="currentSlide().id === 'afsluiting' && tourMode()"
             [class.hidden]="currentSlide().id === 'afsluiting' && tourMode()">

          <!-- Floating title — top-left -->
          <div class="absolute top-10 left-10 md:left-14 z-10">
            <div class="accent-line w-16 h-[2px] bg-gradient-to-r from-[var(--color-starwars-yellow)] to-transparent mb-3 rounded-full shadow-[0_0_12px_rgba(255,232,31,0.4)] origin-left"></div>
            <h2 class="slide-title text-3xl md:text-5xl font-starwars text-[var(--color-starwars-yellow)] uppercase tracking-wider drop-shadow-[0_0_20px_rgba(255,232,31,0.3)]">
              {{ currentSlide().title }}
            </h2>
          </div>

          <!-- ═══ H1: COMPOSITION — floating data around the planet ═══ -->
          @if (currentSlide().id === 'h1') {
            <div class="absolute inset-0 pointer-events-none">
              <div class="slide-item absolute top-[14%] right-[16%] text-right">
                <div class="text-xs font-mono text-cyan-400/70 tracking-[0.3em] mb-1">CLASSIFICATIE</div>
                <div class="text-4xl md:text-6xl font-starwars text-cyan-300/90 drop-shadow-[0_0_30px_rgba(100,210,255,0.4)]">GASREUS</div>
                <div class="text-sm text-white/60 mt-1">Geen steen of zand zoals de aarde</div>
              </div>
              <div class="slide-item absolute top-[38%] right-[6%] md:right-[10%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-6xl md:text-8xl font-starwars text-[var(--color-starwars-yellow)] drop-shadow-[0_0_30px_rgba(255,232,31,0.4)] tabular-nums">90</span>
                  <span class="text-2xl text-[var(--color-starwars-yellow)]/70 font-starwars">%</span>
                </div>
                <div class="text-sm text-white/60 tracking-wider">WATERSTOF (H₂)</div>
              </div>
              <div class="slide-item absolute top-[55%] right-[18%] md:right-[22%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-4xl md:text-6xl font-starwars text-orange-300/85 drop-shadow-[0_0_20px_rgba(255,180,100,0.3)] tabular-nums">10</span>
                  <span class="text-xl text-orange-300/60 font-starwars">%</span>
                </div>
                <div class="text-sm text-white/55 tracking-wider">HELIUM (He)</div>
              </div>
              <div class="slide-item absolute bottom-[28%] right-[10%] md:right-[14%]">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-px bg-gradient-to-r from-transparent to-cyan-400/40"></div>
                  <div>
                    <div class="flex items-baseline gap-1">
                      <span class="text-3xl md:text-4xl font-starwars text-cyan-200/80 tabular-nums">1000</span>
                      <span class="text-sm text-cyan-200/55 tracking-wider">KM</span>
                    </div>
                    <div class="text-xs text-white/50 tracking-wider">DAMPKRING DIKTE</div>
                  </div>
                </div>
              </div>
              <div class="slide-item absolute bottom-[18%] right-[22%]">
                <div class="text-sm text-red-300/70 italic flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full bg-red-400/60"></div>
                  Geen vaste grond om op te landen
                </div>
              </div>
            </div>

          <!-- ═══ H5: SIZE / GRAVITY — floating comparison stats ═══ -->
          } @else if (currentSlide().id === 'h5') {
            <div class="absolute inset-0 pointer-events-none">
              <div class="slide-item absolute top-[12%] right-[14%] text-right">
                <div class="text-xs font-mono text-purple-400/70 tracking-[0.3em] mb-1">MASSA</div>
                <div class="flex items-baseline gap-1 justify-end">
                  <span class="text-5xl md:text-7xl font-starwars text-purple-300/90 drop-shadow-[0_0_25px_rgba(180,130,255,0.4)] tabular-nums">300</span>
                  <span class="text-xl text-purple-300/70 font-starwars">×</span>
                </div>
                <div class="text-sm text-white/60">zwaarder dan de aarde</div>
              </div>
              <div class="slide-item absolute top-[35%] right-[6%] md:right-[8%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-4xl md:text-5xl font-starwars text-[var(--color-starwars-yellow)] drop-shadow-[0_0_20px_rgba(255,232,31,0.3)] tabular-nums">9u 55m</span>
                </div>
                <div class="text-sm text-white/55 tracking-wider">ÉÉN DAG OP JUPITER</div>
              </div>
              <div class="slide-item absolute top-[52%] right-[16%] md:right-[20%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-5xl md:text-6xl font-starwars text-orange-300/90 drop-shadow-[0_0_20px_rgba(255,180,100,0.3)] tabular-nums">2.5</span>
                  <span class="text-xl text-orange-300/65 font-starwars">×</span>
                </div>
                <div class="text-sm text-white/55 tracking-wider">ZWAARTEKRACHT</div>
                <div class="text-xs text-white/50 mt-0.5">Je weegt er flink meer!</div>
              </div>
              <div class="slide-item absolute bottom-[25%] right-[12%]">
                <div class="text-sm text-cyan-300/65 flex items-center gap-2">
                  <div class="w-8 h-px bg-gradient-to-r from-transparent to-cyan-400/45"></div>
                  Allergrootste planeet — een gasreus
                </div>
              </div>
            </div>
            @if (currentSlide().experiment) {
              <div class="absolute bottom-28 left-10 md:left-14 max-w-[35%] slide-item">
                <div class="pl-4 border-l-2 border-green-500/30">
                  <h3 class="text-base font-starwars text-green-400/80 mb-2 flex items-center gap-2">
                    <mat-icon class="!text-sm">science</mat-icon> {{ currentSlide().experiment?.title }}
                  </h3>
                  <p class="text-green-200/65 mb-2 text-sm">{{ currentSlide().experiment?.description }}</p>
                  <ul class="space-y-1.5 text-green-100/70 text-sm">
                    @for (instruction of currentSlide().experiment?.instructions; track $index) {
                      <li class="flex items-start gap-1.5">
                        <span class="text-green-500/60 mt-0.5 text-xs">▶</span>
                        <span>{{ instruction }}</span>
                      </li>
                    }
                  </ul>
                </div>
              </div>
            }

          <!-- ═══ EXTRA: MOONS — floating moon data ═══ -->
          } @else if (currentSlide().id === 'extra') {
            <div class="absolute inset-0 pointer-events-none">
              <div class="slide-item absolute top-[12%] right-[18%] text-right">
                <div class="text-xs font-mono text-blue-400/70 tracking-[0.3em] mb-1">MAANSYSTEEM</div>
                <div class="flex items-baseline gap-1 justify-end">
                  <span class="text-6xl md:text-8xl font-starwars text-blue-300/90 drop-shadow-[0_0_30px_rgba(100,150,255,0.4)] tabular-nums">95</span>
                </div>
                <div class="text-sm text-white/60">manen in een baan om Jupiter</div>
              </div>
              <div class="slide-item absolute top-[38%] right-[6%] md:right-[8%]">
                <div class="text-xl md:text-2xl font-starwars text-cyan-200/85 drop-shadow-[0_0_15px_rgba(100,210,255,0.3)]">EUROPA</div>
                <div class="text-sm text-white/55 mt-1 max-w-[220px]">Oceaan onder het ijs — misschien leven?</div>
              </div>
              <div class="slide-item absolute top-[56%] right-[18%] md:right-[22%]">
                <div class="text-xl md:text-2xl font-starwars text-yellow-300/85 drop-shadow-[0_0_15px_rgba(255,200,50,0.3)]">IO</div>
                <div class="text-sm text-white/55 mt-1 max-w-[200px]">Vulkanen door Jupiters zwaartekracht</div>
              </div>
              <div class="slide-item absolute bottom-[24%] right-[14%]">
                <div class="text-sm text-red-300/65 italic flex items-center gap-2">
                  <div class="w-1.5 h-1.5 rounded-full bg-red-400/60"></div>
                  Extreme druk, wind en geen grond
                </div>
              </div>
            </div>

          <!-- ═══ QUIZ — interactive layout ═══ -->
          } @else if (currentSlide().quiz) {
            @let quiz = currentSlide().quiz!;
            <div class="absolute top-28 left-10 md:left-14 bottom-28 max-w-[45%] overflow-y-auto">
              @if (currentQuizQuestionIndex() < quiz.length) {
                @let q = quiz[currentQuizQuestionIndex()];
                <div class="slide-item">
                  <span class="text-blue-400/60 font-starwars text-base tracking-widest mb-3 block">Vraag {{ currentQuizQuestionIndex() + 1 }} / {{ quiz.length }}</span>
                  <p class="text-2xl md:text-3xl text-white/90 font-medium mb-6 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">{{ q.question }}</p>
                  <div class="grid grid-cols-1 gap-3 mb-6">
                    @for (option of q.options; track $index) {
                      <div (click)="!isAnswerRevealed() && selectQuizOption($index)"
                           class="quiz-option px-5 py-4 rounded-lg transition-all duration-300 flex items-center text-lg md:text-xl font-semibold backdrop-blur-sm"
                           [class]="isAnswerRevealed() 
                                    ? ($index === q.correctOptionIndex 
                                        ? 'bg-green-500/15 border-l-3 border-green-400 text-white shadow-[0_0_15px_rgba(74,222,128,0.2)]' 
                                        : 'bg-white/[0.03] border-l-3 border-red-500/20 text-gray-500 opacity-40')
                                    : selectedQuizOption() === $index
                                      ? 'bg-[var(--color-starwars-yellow)]/10 border-l-3 border-[var(--color-starwars-yellow)] text-white cursor-pointer'
                                      : 'bg-white/[0.03] border-l-3 border-white/10 text-white/70 hover:bg-white/[0.06] cursor-pointer hover:border-white/20'">
                        <span class="mr-3 text-xs opacity-40 font-starwars">{{ ['A','B','C','D'][$index] }}</span>
                        {{ option }}
                      </div>
                    }
                  </div>
                  @if (isAnswerRevealed()) {
                    <div class="mb-6 pl-4 border-l-2 border-green-500/25 animate-fade-in">
                      <p class="text-green-200/75 text-base">{{ q.explanation }}</p>
                    </div>
                  }
                  <div class="flex justify-start gap-3">
                    @if (!isAnswerRevealed()) {
                      <button (click)="revealAnswer()" 
                              [disabled]="selectedQuizOption() === -1"
                              class="px-5 py-2.5 bg-[var(--color-starwars-yellow)]/90 text-black font-starwars text-sm tracking-widest rounded-lg hover:bg-[var(--color-starwars-yellow)] transition-all disabled:opacity-20 disabled:cursor-not-allowed">
                        {{ selectedQuizOption() === -1 ? 'Kies een antwoord' : 'Toon Antwoord' }}
                      </button>
                    } @else {
                      <button (click)="nextQuizQuestion()" class="px-5 py-2.5 bg-blue-500/50 text-white font-starwars text-sm tracking-widest rounded-lg hover:bg-blue-400/50 transition-colors">
                        {{ currentQuizQuestionIndex() === quiz.length - 1 ? 'Einde Afvalrace' : 'Volgende Vraag' }}
                      </button>
                    }
                  </div>
                </div>
              } @else {
                <div class="text-left quiz-complete slide-item">
                  <mat-icon class="text-5xl text-[var(--color-starwars-yellow)] mb-3 drop-shadow-[0_0_15px_rgba(255,232,31,0.4)] trophy-bounce" style="height: 50px; width: 50px; font-size: 50px;">emoji_events</mat-icon>
                  <h3 class="text-3xl font-starwars text-[var(--color-starwars-yellow)] mb-3 tracking-widest title-shimmer">Gefeliciteerd!</h3>
                  <p class="text-xl text-green-100/70">Jullie zijn de ultieme Jupiter-experts!</p>
                </div>
              }
            </div>
            <div class="absolute bottom-16 left-10 md:left-14 max-w-[35%]">
              <div class="space-y-1.5">
                @for (line of currentSlide().content; track $index) {
                  <p class="slide-item text-sm text-white/55 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">{{ line }}</p>
                }
              </div>
            </div>

          <!-- ═══ DEFAULT: subtle content bottom-left ═══ -->
          } @else {
            <div class="absolute bottom-20 left-10 md:left-14 max-w-[38%] flex flex-col gap-6">
              <div class="space-y-3">
                @for (line of currentSlide().content; track $index) {
                  <p class="slide-item text-base md:text-lg text-white/85 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">{{ line }}</p>
                }
              </div>
              @if (currentSlide().experiment) {
                <div class="slide-item pl-4 border-l-2 border-green-500/30">
                  <h3 class="text-base font-starwars text-green-400/80 mb-2 flex items-center gap-2">
                    <mat-icon class="!text-sm">science</mat-icon> {{ currentSlide().experiment?.title }}
                  </h3>
                  <p class="text-green-200/65 mb-2 text-sm">{{ currentSlide().experiment?.description }}</p>
                  <ul class="space-y-1.5 text-green-100/70 text-sm">
                    @for (instruction of currentSlide().experiment?.instructions; track $index) {
                      <li class="flex items-start gap-1.5">
                        <span class="text-green-500/60 mt-0.5 text-xs">▶</span>
                        <span>{{ instruction }}</span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          }

          <!-- Distance counter (h3) — floating near the beam -->
          @if (currentSlide().id === 'h3' && currentDistance() > 0) {
            <div class="absolute right-[10%] top-1/2 -translate-y-1/2 slide-item text-right pointer-events-none">
              <div class="text-xs text-[var(--color-starwars-yellow)]/65 font-starwars tracking-[0.3em] mb-1">HUIDIGE AFSTAND</div>
              <div class="flex items-baseline gap-1 justify-end">
                <span class="text-5xl md:text-7xl font-starwars text-[var(--color-starwars-yellow)] tracking-wider tabular-nums drop-shadow-[0_0_20px_rgba(255,232,31,0.4)]">{{ currentDistance() }}</span>
                <span class="text-sm text-[var(--color-starwars-yellow)]/60 font-starwars tracking-wider">M KM</span>
              </div>
              <div class="mt-2 text-sm text-[var(--color-starwars-yellow)]/55 font-mono tracking-wider">
                ☀️ Licht: {{ lightTravelMinutes() }} min
              </div>
            </div>
          }

        </div>
      }

      <!-- Planet Tour Overlay — stat cards styled like slide floating data widgets -->
      @if (tourMode() && tourCurrentPlanet() && planetFacts[tourCurrentPlanet()]) {
        @let pf = planetFacts[tourCurrentPlanet()];
        <div class="absolute inset-0 pointer-events-none">
          <!-- Readability gradients -->
          <div class="absolute inset-0 bg-gradient-to-r from-black/65 via-black/10 to-transparent"></div>
          <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/15"></div>
          <!-- Tour stats panel — bottom left -->
          <div class="absolute bottom-20 left-8 md:left-12 tour-facts-card">
            <!-- Accent bar + planet name -->
            <div class="tour-accent-line w-16 h-[2px] bg-gradient-to-r from-[var(--color-starwars-yellow)] to-transparent mb-3 rounded-full shadow-[0_0_10px_rgba(255,232,31,0.35)]"></div>
            <div class="flex items-center gap-2.5 mb-5">
              <span class="text-3xl leading-none">{{ pf.icon }}</span>
              <h2 class="text-3xl md:text-5xl font-starwars uppercase tracking-wider drop-shadow-[0_0_18px_rgba(0,0,0,0.8)]"
                  [style.color]="pf.color">{{ pf.title }}</h2>
            </div>
            <!-- 2x2 stat card grid -->
            <div class="grid grid-cols-2 gap-x-10 gap-y-6">
              @for (stat of pf.stats; track $index) {
                <div class="tour-stat-card" [style.animation-delay]="($index * 130 + 150) + 'ms'">
                  <div class="text-xs font-mono tracking-[0.25em] mb-1 text-white/55">{{ stat.label }}</div>
                  <div class="text-3xl md:text-4xl font-starwars tabular-nums leading-tight"
                       [style.color]="pf.color"
                       [style.text-shadow]="'0 0 20px ' + pf.color">{{ stat.value }}</div>
                  @if (stat.sub) {
                    <div class="text-sm text-white/50 mt-1 max-w-[170px]">{{ stat.sub }}</div>
                  }
                </div>
              }
            </div>
          </div>
        </div>
      }

      <!-- Mute Toggle -->
      @if (hasStarted()) {
        <button (click)="toggleMute()" 
                class="absolute top-6 right-6 z-20 p-2 rounded-full bg-black/40 border border-white/10 text-white/50 hover:text-white hover:bg-black/60 transition-all duration-300 pointer-events-auto backdrop-blur-sm">
          <mat-icon>{{ isMuted() ? 'volume_off' : 'volume_up' }}</mat-icon>
        </button>
      }

      <!-- Navigation Controls -->
      <div class="absolute bottom-4 left-0 right-0 flex items-center justify-between px-12 pointer-events-auto z-20">
        <button 
          (click)="prevSlide()" 
          [disabled]="currentIndex() === 0 || isTransitioning()"
          class="p-3 rounded-full bg-black/40 border border-white/10 text-[var(--color-starwars-yellow)] hover:bg-[var(--color-starwars-yellow)] hover:text-black hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:bg-black/40 disabled:hover:text-[var(--color-starwars-yellow)] backdrop-blur-sm">
          <mat-icon>chevron_left</mat-icon>
        </button>
        
        <!-- Progress Dots -->
        <div class="flex items-center gap-2">
          @for (slide of slides; track $index) {
            <div class="transition-all duration-500 rounded-full" 
                 [class]="$index === currentIndex() 
                   ? 'w-8 h-2 bg-[var(--color-starwars-yellow)] shadow-[0_0_12px_rgba(255,232,31,0.6)]' 
                   : $index < currentIndex() 
                     ? 'w-2 h-2 bg-[var(--color-starwars-yellow)]/50' 
                     : 'w-2 h-2 bg-white/20'">
            </div>
          }
        </div>

        <button 
          (click)="nextSlide()" 
          [disabled]="currentIndex() === totalSlides() - 1 || isTransitioning()"
          class="p-3 rounded-full bg-black/40 border border-white/10 text-[var(--color-starwars-yellow)] hover:bg-[var(--color-starwars-yellow)] hover:text-black hover:scale-110 active:scale-95 transition-all duration-300 disabled:opacity-20 disabled:hover:scale-100 disabled:hover:bg-black/40 disabled:hover:text-[var(--color-starwars-yellow)] backdrop-blur-sm">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </div>
  `,
  styleUrl: './app.css'
})
export class App implements AfterViewInit, OnDestroy {
  slides = SLIDES;
  nameChars = [...'Asbjørn Oost'];
  currentIndex = signal(0);
  currentQuizQuestionIndex = signal(0);
  isAnswerRevealed = signal(false);
  isTransitioning = signal(false);
  direction = signal<1 | -1>(1);
  videoRevealed = signal(false);
  hasStarted = signal(false);
  isMuted = signal(false);
  selectedQuizOption = signal(-1);
  sceneLoaded = signal(false);
  telemetry = signal<{altitude: number, speed: number, phase: string} | null>(null);
  loadingProgress = signal<number>(0);
  currentDistance = signal(0);
  celebrationActive = signal(false);
  tourMode = signal(false);
  tourCurrentPlanet = signal('');
  private tourTimer: ReturnType<typeof setTimeout> | null = null;
  // t = d/c: light-travel time in minutes (c = 299,792 km/s)
  lightTravelMinutes = computed(() => (this.currentDistance() * 1_000_000 / 299_792 / 60).toFixed(1));
  // 1 AU = 149,597,870.7 km
  lightTravelAU = computed(() => (this.currentDistance() * 1_000_000 / 149_597_870.7).toFixed(2));
  private videoRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly bgMusicVolumeTween: ReturnType<typeof setInterval> | null = null;
  private bgMusicVolumeRafId: number | null = null;
  private bgAudioKickoffTimer: ReturnType<typeof setInterval> | null = null;
  private readonly isBrowser: boolean;
  private readonly platformId = inject(PLATFORM_ID);
  private audioCtx: AudioContext | null = null;
  private falconAudioPlaying = false;
  private moonAudioPlayed = false;
  private moonAudioSequenceId = 0;
  private readonly moonAudioTimers: ReturnType<typeof setTimeout>[] = [];
  private readonly nasaClipBufferCache = new Map<string, Promise<AudioBuffer>>();

  currentSlide = computed(() => this.slides[this.currentIndex()]);
  totalSlides = computed(() => this.slides.length);

  @ViewChild('slideContainer') slideContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('crawlContainer') crawlContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('bgVideo') bgVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('bgAudio') bgAudio?: ElementRef<HTMLAudioElement>;
  @ViewChild('celebrationCanvas') celebrationCanvas?: ElementRef<HTMLCanvasElement>;
  private celebrationAnimId: number | null = null;

  bgAudioSrc = 'interstellar-theme.mp3';

  constructor() {
    this.isBrowser = isPlatformBrowser(this.platformId);
    
    effect(() => {
      // Reset quiz state when slide changes
      const current = this.currentSlide();
      if (current.quiz) {
        this.currentQuizQuestionIndex.set(0);
        this.isAnswerRevealed.set(false);
        this.selectedQuizOption.set(-1);
      }

      // Fire space celebration on the "Einde" slide
      if (current.id === 'afsluiting' && this.isBrowser) {
        setTimeout(() => this.fireSpaceCelebration('finale'), 600);
        // After 10 seconds, fade out text and start planet tour
        if (this.tourTimer) clearTimeout(this.tourTimer);
        this.tourTimer = setTimeout(() => {
          this.tourMode.set(true);
        }, 10000);
      } else {
        // Cancel tour if navigating away from afsluiting
        if (this.tourTimer) { clearTimeout(this.tourTimer); this.tourTimer = null; }
        this.tourMode.set(false);
        this.tourCurrentPlanet.set('');
      }
      
      // Animate new slide content
      if (this.isBrowser) {
        // Clear any pending video reveal
        if (this.videoRevealTimer) { clearTimeout(this.videoRevealTimer); this.videoRevealTimer = null; }
        this.videoRevealed.set(false);

        setTimeout(() => {
          this.animateSlideIn();
          // If slide has a video, start playback and schedule the 3D fade-out reveal
          if (current.video) {
            const vid = this.bgVideo?.nativeElement;
            if (vid) {
              if (current.id === 'h5') {
                vid.volume = 0;
                vid.muted = true;
                vid.playbackRate = 0.7;
              } else {
                vid.volume = 0.15;
                vid.muted = false;
                vid.playbackRate = 1;
              }
              vid.play().catch(() => {});
            }
            // Duck the background music while video plays
            this.fadeBgMusicTo(0.1);
            this.videoRevealTimer = setTimeout(() => this.videoRevealed.set(true), 1800);
          } else {
            // Restore background music on non-video slides
            this.fadeBgMusicTo(0.3);
          }
        }, 50);
      }
    });
  }

  ngAfterViewInit() {
    if (this.isBrowser) {
      this.animateSlideIn();
    }
  }

  ngOnDestroy() {
    if (this.bgMusicVolumeTween) clearInterval(this.bgMusicVolumeTween);
    if (this.bgMusicVolumeRafId) cancelAnimationFrame(this.bgMusicVolumeRafId);
    if (this.bgAudioKickoffTimer) clearInterval(this.bgAudioKickoffTimer);
    if (this.videoRevealTimer) clearTimeout(this.videoRevealTimer);
    if (this.tourTimer) clearTimeout(this.tourTimer);
    this.clearMoonAudioTimers();
    if (this.celebrationAnimId) cancelAnimationFrame(this.celebrationAnimId);
  }

  onSceneLoaded() {
    this.sceneLoaded.set(true);
  }

  onDistanceUpdate(km: number) {
    this.currentDistance.set(km);
  }

  onTourPlanet(planetName: string) {
    this.tourCurrentPlanet.set(planetName);
    // Audio Easter eggs
    if (planetName === 'maan' && !this.moonAudioPlayed && !this.isMuted()) {
      this.moonAudioPlayed = true;
      this.playMoonLandingAudioSequence();
    }
    if (planetName !== 'maan') {
      this.moonAudioPlayed = false;
      this.clearMoonAudioTimers();
      this.fadeBgMusicTo(0.3);
    }
    // Falcon launch rumble when arriving at Earth (Falcon launches 1.5s after)
    if (planetName === 'aarde' && !this.falconAudioPlaying && !this.isMuted()) {
      this.falconAudioPlaying = true;
      setTimeout(() => {
        this.playRocketRumble(16);
        setTimeout(() => { this.falconAudioPlaying = false; }, 18000);
      }, 1500);
    }
  }

  // Planet facts for the tour — each planet has 4 stat cards (value + label + sub)
  // styled like the slide floating data widgets for visual consistency.
  readonly planetFacts: Record<string, {
    title: string; icon: string; color: string;
    stats: { value: string; label: string; sub?: string }[];
  }> = {
    'jupiter': { title: 'Jupiter', icon: '🪐', color: 'rgba(255,232,31,0.92)',
      stats: [
        { value: '95', label: 'MANEN', sub: 'in baan om Jupiter' },
        { value: '300×', label: 'MASSA', sub: 'zwaarder dan de Aarde' },
        { value: '90%', label: 'WATERSTOF', sub: '+ 10% helium' },
        { value: 'GRS', label: 'SUPERSTORM', sub: 'Grote Rode Vlek' },
      ]},
    'zon': { title: 'De Zon', icon: '☀️', color: 'rgba(255,200,60,0.92)',
      stats: [
        { value: '5.500°C', label: 'BUITENKANT', sub: 'kern: 15 mln °C' },
        { value: '1,3 MLN×', label: 'VOLUME', sub: 'groter dan de Aarde' },
        { value: '8 min', label: 'LICHT REISTIJD', sub: 'zon → aarde' },
        { value: 'G2V', label: 'STERTYPE', sub: 'gele dwergster' },
      ]},
    'mercurius': { title: 'Mercurius', icon: '🪨', color: 'rgba(210,195,175,0.90)',
      stats: [
        { value: '430°C', label: 'OVERDAG', sub: '-180°C \'s nachts' },
        { value: '88d', label: 'EEN JAAR', sub: 'kortste omloop' },
        { value: '0', label: 'MANEN', sub: 'geheel alleen' },
        { value: '0.4×', label: 'GROOTTE', sub: 'vs. Aarde' },
      ]},
    'venus': { title: 'Venus', icon: '🌕', color: 'rgba(220,185,100,0.90)',
      stats: [
        { value: '465°C', label: 'TEMPERATUUR', sub: 'heetste planeet!' },
        { value: 'H₂SO₄', label: 'WOLKEN', sub: 'zwavelzuur' },
        { value: '−1', label: 'ROTATIE', sub: 'draait andersom' },
        { value: '0.9×', label: 'GROOTTE', sub: 'vs. Aarde' },
      ]},
    'aarde': { title: 'De Aarde', icon: '🌍', color: 'rgba(100,200,255,0.92)',
      stats: [
        { value: '71%', label: 'WATEROPPERVLAK', sub: 'uniek in ons stelsel' },
        { value: '1', label: 'MAAN', sub: 'Luna, onze trouwe maan' },
        { value: '24u', label: 'EEN DAG', sub: 'aardse dag' },
        { value: '🚀', label: 'FALCON 9', sub: 'nu op weg naar Mars!' },
      ]},
    'maan': { title: 'De Maan', icon: '🌙', color: 'rgba(200,200,190,0.90)',
      stats: [
        { value: '0.674°N', label: 'BREEDTEGRAAD', sub: 'Tranquility Base' },
        { value: '23.473°E', label: 'LENGTEGRAAD', sub: 'Mare Tranquillitatis' },
        { value: '1969', label: 'APOLLO 11', sub: '20 juli — maanlanding' },
        { value: '∅ wind', label: 'VOETSPOREN', sub: 'voor altijd in het stof' },
      ]},
    'columbia': { title: 'Columbia', icon: '🛰️', color: 'rgba(255,150,105,0.94)',
      stats: [
        { value: 'STS-107', label: 'MISSIE', sub: 'wetenschappelijke shuttlevlucht' },
        { value: '7', label: 'BEMANNING', sub: 'zeven astronauten herdacht' },
        { value: '1 FEB 2003', label: 'RAMP', sub: 'tijdens terugkeer naar de aarde' },
        { value: 'RE-ENTRY', label: 'LOCATIE', sub: 'hoog in de aardatmosfeer' },
      ]},
    'mars': { title: 'Mars', icon: '🔴', color: 'rgba(230,100,60,0.92)',
      stats: [
        { value: '21 km', label: 'OLYMPUS MONS', sub: 'hoogste berg ooit' },
        { value: '2', label: 'MANEN', sub: 'Phobos & Deimos' },
        { value: '-65°C', label: 'TEMPERATUUR', sub: 'gemiddeld op Mars' },
        { value: '1.9j', label: 'EEN JAAR', sub: 'op Mars duurt langer' },
      ]},
    'starman': { title: 'Starman', icon: '🚗', color: 'rgba(200,40,40,0.92)',
      stats: [
        { value: 'Tesla', label: 'ROADSTER', sub: 'rode sportwagen' },
        { value: '2018', label: 'GELANCEERD', sub: 'SpaceX Falcon Heavy' },
        { value: '∞', label: 'IN DE RUIMTE', sub: 'draait om de zon' },
        { value: '🎵', label: 'DAVID BOWIE', sub: 'Space Oddity speelt' },
      ]},
    'saturnus': { title: 'Saturnus', icon: '🪐', color: 'rgba(220,195,140,0.92)',
      stats: [
        { value: '146', label: 'MANEN', sub: 'waaronder Titan' },
        { value: '0.7', label: 'DICHTHEID', sub: 'drijft op water!' },
        { value: '300.000', label: 'RING BREEDTE', sub: 'km — slechts 1 km dik' },
        { value: '10.7u', label: 'EEN DAG', sub: 'op Saturnus' },
      ]},
    'uranus': { title: 'Uranus', icon: '🔵', color: 'rgba(100,230,210,0.92)',
      stats: [
        { value: '98°', label: 'KANTELHOEK', sub: 'draait op z\'n zij!' },
        { value: '-224°C', label: 'TEMPERATUUR', sub: 'koudste planeet' },
        { value: '27', label: 'MANEN', sub: 'Shakespeare-namen' },
        { value: '84j', label: 'EEN JAAR', sub: 'op Uranus' },
      ]},
    'neptunus': { title: 'Neptunus', icon: '🔵', color: 'rgba(80,130,255,0.92)',
      stats: [
        { value: '2100 km/u', label: 'WIND', sub: 'snelste winden!' },
        { value: '4,5 mrd', label: 'ZON-AFSTAND', sub: 'km van de Zon' },
        { value: '165j', label: 'EEN JAAR', sub: 'op Neptunus' },
        { value: '14', label: 'MANEN', sub: 'waaronder Triton' },
      ]},
    'pluto': { title: 'Pluto', icon: '🌑', color: 'rgba(196,168,130,0.90)',
      stats: [
        { value: 'DWERG', label: 'PLANEETSTATUS', sub: 'geen echte planeet' },
        { value: '248j', label: 'EEN JAAR', sub: 'op Pluto' },
        { value: '5', label: 'MANEN', sub: 'waaronder Charon' },
        { value: '-230°C', label: 'TEMPERATUUR', sub: 'ijzig koud!' },
      ]},
    'blackhole': { title: 'Zwart Gat', icon: '🕳️', color: 'rgba(255,120,50,0.95)',
      stats: [
        { value: '∞', label: 'ZWAARTEKRACHT', sub: 'Licht kan niet ontsnappen' },
        { value: 'Gargantua', label: 'CLASSIFICATIE', sub: 'Superzwaar Zwart Gat' },
        { value: '1=7', label: 'TIJDSVERTRAGING', sub: '1 uur hier = 7 jaar op aarde' },
        { value: 'Horizon', label: 'EVENT', sub: 'Point of no return' },
      ]},
    'jupiter-einde': { title: 'Terug bij Jupiter', icon: '✨', color: 'rgba(255,232,31,0.92)',
      stats: [
        { value: '#1', label: 'GROOTSTE', sub: 'planeet in ons stelsel' },
        { value: '95', label: 'MANEN', sub: 'en nog meer ontdekt!' },
        { value: '1300×', label: 'VOLUME', sub: 'vs. de Aarde' },
        { value: '♾️', label: 'BEDANKT!', sub: 'voor het kijken!' },
      ]},
  };

    startPresentation() {
    if (!this.sceneLoaded()) return;
    this.hasStarted.set(true);
    this.startBgAudio();
    // Auto-advance to the next slide after a short moment
    setTimeout(() => this.nextSlide(), 800);
  }

  private startBgAudio() {
    const audio = this.bgAudio?.nativeElement;
    if (!audio) return;
    if (this.bgAudioKickoffTimer) {
      clearInterval(this.bgAudioKickoffTimer);
      this.bgAudioKickoffTimer = null;
    }
    audio.load();
    audio.volume = 0.3;
    audio.currentTime = Math.max(0, audio.currentTime || 0);
    const tryPlay = () => {
      if (!audio.paused) {
        if (this.bgAudioKickoffTimer) {
          clearInterval(this.bgAudioKickoffTimer);
          this.bgAudioKickoffTimer = null;
        }
        return;
      }
      audio.play().catch(() => {});
    };
    audio.play().catch(() => {
      // Autoplay blocked — start on first user interaction
      const resume = () => {
        tryPlay();
        document.removeEventListener('click', resume);
        document.removeEventListener('pointerdown', resume);
        document.removeEventListener('touchstart', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('pointerdown', resume, { once: true });
      document.addEventListener('touchstart', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    });

    // Keep trying briefly until the browser allows playback.
    this.bgAudioKickoffTimer = setInterval(() => {
      if (!audio.paused) {
        if (this.bgAudioKickoffTimer) {
          clearInterval(this.bgAudioKickoffTimer);
          this.bgAudioKickoffTimer = null;
        }
        return;
      }
      tryPlay();
    }, 1200);
  }

  async animateSlideOut(dir: number) {
    if (!this.isBrowser) return;
    
    const customEase = cubicBezier(0.4, 0, 0.2, 1);
    const animations: Promise<unknown>[] = [];

    if (this.crawlContainer?.nativeElement) {
      animations.push(
        animate(
          this.crawlContainer.nativeElement,
          { 
            y: [0, dir === 1 ? '-40vh' : '40vh'],
            opacity: [1, 0],
            filter: ['blur(0px)', 'blur(16px)'],
            scale: [1, 0.8]
          },
          { duration: 0.6, ease: customEase }
        ).finished
      );
    }

    if (this.slideContainer?.nativeElement) {
      animations.push(
        animate(
          this.slideContainer.nativeElement,
          { 
            x: [0, dir === 1 ? -200 : 200],
            y: [0, dir === 1 ? -30 : 30],
            opacity: [1, 0],
            filter: ['blur(0px)', 'blur(16px)'],
            scale: [1, 0.85]
          },
          { duration: 0.6, ease: customEase }
        ).finished
      );
    }

    if (animations.length > 0) {
      await Promise.all(animations);
    }
  }

  animateSlideIn() {
    if (!this.isBrowser) return;

    const customEase = cubicBezier(0.16, 1, 0.3, 1);
    const dir = this.direction();

    this.animateCrawlIn(dir);
    if (this.animateSlideContainerIn(dir, customEase)) {
      return;
    }

    if (!this.crawlContainer?.nativeElement) {
      setTimeout(() => this.isTransitioning.set(false), 500);
    }
  }

  private animateCrawlIn(dir: 1 | -1) {
    const crawlEl = this.crawlContainer?.nativeElement;
    if (!crawlEl) {
      return;
    }

    animate(
      crawlEl,
      {
        y: [dir === 1 ? '40vh' : '-40vh', '0vh'],
        opacity: [0, 1],
        rotateX: [40, 20],
        filter: ['blur(16px)', 'blur(0px)'],
        scale: [0.8, 1]
      },
      { duration: 1.2, ease: 'easeOut' }
    ).finished.then(() => {
      this.clearAnimatedInlineStyles(crawlEl);
      this.isTransitioning.set(false);
    });
  }

  private animateSlideContainerIn(dir: 1 | -1, customEase: ReturnType<typeof cubicBezier>): boolean {
    const container = this.slideContainer?.nativeElement;
    if (!container) {
      return false;
    }

    const items = container.querySelectorAll('.slide-item');
    const accentLine = container.querySelector('.accent-line');

    animate(
      container,
      {
        opacity: [0, 1],
        scale: [0.85, 1],
        x: [dir === 1 ? 200 : -200, 0],
        y: [dir === 1 ? 30 : -30, 0],
        filter: ['blur(16px)', 'blur(0px)']
      },
      { duration: 0.9, ease: customEase }
    ).finished.then(() => {
      this.isTransitioning.set(false);
    });

    if (accentLine) {
      animate(
        accentLine,
        { scaleX: [0, 1], opacity: [0, 1] },
        { duration: 0.8, delay: 0.2, ease: customEase }
      );
    }

    if (items.length > 0) {
      animate(
        items,
        {
          opacity: [0, 1],
          x: [dir === 1 ? 40 : -40, 0],
          y: [15, 0],
          filter: ['blur(6px)', 'blur(0px)']
        },
        { delay: stagger(0.12), duration: 0.8, ease: customEase }
      );
    }

    return true;
  }

  private clearAnimatedInlineStyles(element: HTMLElement) {
    element.style.removeProperty('opacity');
    element.style.removeProperty('filter');
    element.style.removeProperty('transform');
    element.style.removeProperty('will-change');
    element.style.removeProperty('scale');
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyDown(event: KeyboardEvent) {
    if (this.isTransitioning()) return;
    // Block keyboard nav until presentation has started
    if (!this.hasStarted()) {
      if ((event.key === ' ' || event.key === 'Enter') && this.sceneLoaded()) {
        this.startPresentation();
      }
      return;
    }
    if (event.key === 'm' || event.key === 'M') {
      this.toggleMute();
    } else if (event.key === 'ArrowRight' || event.key === ' ') {
      this.nextSlide();
    } else if (event.key === 'ArrowLeft') {
      this.prevSlide();
    }
  }

  async nextSlide() {
    if (this.currentIndex() < this.totalSlides() - 1 && !this.isTransitioning()) {
      this.isTransitioning.set(true);
      this.direction.set(1);
      await this.animateSlideOut(1);
      this.currentIndex.update(i => i + 1);
    }
  }

  async prevSlide() {
    if (this.currentIndex() > 0 && !this.isTransitioning()) {
      this.isTransitioning.set(true);
      this.direction.set(-1);
      await this.animateSlideOut(-1);
      this.currentIndex.update(i => i - 1);
    }
  }

  selectQuizOption(index: number) {
    this.selectedQuizOption.set(index);
  }

  revealAnswer() {
    this.isAnswerRevealed.set(true);
    if (this.isBrowser) {
      this.fireSpaceCelebration('answer');
    }
  }

  nextQuizQuestion() {
    this.isAnswerRevealed.set(false);
    this.selectedQuizOption.set(-1);
    const quiz = this.currentSlide().quiz;
    const nextIdx = this.currentQuizQuestionIndex() + 1;
    this.currentQuizQuestionIndex.set(nextIdx);
    // Fire grand space celebration when quiz is completed
    if (quiz && nextIdx >= quiz.length && this.isBrowser) {
      setTimeout(() => this.fireSpaceCelebration('finale'), 300);
    }
  }

  toggleMute() {
    const audio = this.bgAudio?.nativeElement;
    if (!audio) return;
    this.isMuted.update(m => !m);
    audio.muted = this.isMuted();
  }

  private fadeBgMusicTo(target: number) {
    const audio = this.bgAudio?.nativeElement;
    if (!audio || this.isMuted()) return;
    if (this.bgMusicVolumeRafId) cancelAnimationFrame(this.bgMusicVolumeRafId);
    const step = () => {
      if (!audio || document.hidden) {
        // Pause fading when tab is hidden to avoid glitches
        this.bgMusicVolumeRafId = requestAnimationFrame(step);
        return;
      }
      const diff = target - audio.volume;
      if (Math.abs(diff) < 0.01) {
        audio.volume = target;
        this.bgMusicVolumeRafId = null;
        return;
      }
      audio.volume += diff * 0.08;
      this.bgMusicVolumeRafId = requestAnimationFrame(step);
    };
    this.bgMusicVolumeRafId = requestAnimationFrame(step);
  }

  private playMoonLandingAudioSequence() {
    const sequenceId = this.beginMoonAudioSequence();
    void this.runMoonLandingAudioSequence(sequenceId);
  }

  private beginMoonAudioSequence(): number {
    this.clearMoonAudioTimers();
    this.moonAudioSequenceId += 1;
    this.fadeBgMusicTo(0.08);
    return this.moonAudioSequenceId;
  }

  private async runMoonLandingAudioSequence(sequenceId: number) {
    if (!await this.waitForMoonAudio(900, sequenceId)) {
      return;
    }

    const contactDuration = await this.playNasaClip('contact_light.mp3', 0.35, sequenceId);
    if (!this.isMoonAudioSequenceCurrent(sequenceId)) {
      return;
    }

    if (!await this.waitForMoonAudio(contactDuration * 1000 + 650, sequenceId)) {
      return;
    }

    const stepDuration = await this.playNasaClip(['one_small_step.oga', 'one_small_step.mp3', 'a11_step.wav'], 0.7, sequenceId);
    if (!this.isMoonAudioSequenceCurrent(sequenceId)) {
      return;
    }

    if (!await this.waitForMoonAudio(stepDuration * 1000 + 800, sequenceId)) {
      return;
    }

    this.fadeBgMusicTo(0.3);
  }

  private queueMoonAudio(delayMs: number, playback: () => void) {
    const timer = setTimeout(() => {
      const timerIndex = this.moonAudioTimers.indexOf(timer);
      if (timerIndex >= 0) {
        this.moonAudioTimers.splice(timerIndex, 1);
      }
      playback();
    }, delayMs);
    this.moonAudioTimers.push(timer);
  }

  private clearMoonAudioTimers() {
    this.moonAudioTimers.splice(0).forEach((timer) => clearTimeout(timer));
    this.moonAudioSequenceId += 1;
  }

  private waitForMoonAudio(delayMs: number, sequenceId: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isMoonAudioSequenceCurrent(sequenceId)) {
        resolve(false);
        return;
      }

      this.queueMoonAudio(delayMs, () => resolve(this.isMoonAudioSequenceCurrent(sequenceId)));
    });
  }

  private isMoonAudioSequenceCurrent(sequenceId: number): boolean {
    return this.moonAudioSequenceId === sequenceId && this.moonAudioPlayed && !this.isMuted();
  }

  /** Play a voice line through radio static (Web Audio + Speech Synthesis) */
  private playRadioVoice(text: string, volume: number) {
    if (!this.isBrowser) return;
    const ctx = this.getOrCreateAudioContext();

    // Radio static noise bed
    const noiseDuration = text.length * 0.08 + 2;
    const sampleRate = ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, sampleRate * noiseDuration, sampleRate);
    const noiseData = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseData.length; i++) {
      noiseData[i] = (Math.random() * 2 - 1) * 0.15;
    }
    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    // Bandpass filter to make it sound like radio static
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2000;
    bandpass.Q.value = 0.7;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = volume * 0.3;

    noiseSource.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noiseSource.start();
    noiseSource.stop(ctx.currentTime + noiseDuration);

    // Fade the static out at the end
    noiseGain.gain.setValueAtTime(volume * 0.3, ctx.currentTime + noiseDuration - 0.8);
    noiseGain.gain.linearRampToValueAtTime(0, ctx.currentTime + noiseDuration);

    // Speech synthesis for the voice line
    if ('speechSynthesis' in globalThis) {
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.85;
      utter.pitch = 0.9;
      utter.volume = volume;
      // Prefer an English voice
      const voices = globalThis.speechSynthesis.getVoices();
      const enVoice = voices.find(v => v.lang.startsWith('en'));
      if (enVoice) utter.voice = enVoice;
      globalThis.speechSynthesis.speak(utter);
    }
  }

  /** Play a real NASA audio clip with radio-static overlay */
  private async playNasaClip(url: string | string[], volume: number, sequenceId?: number): Promise<number> {
    if (!this.isBrowser) return 0;
    const ctx = this.getOrCreateAudioContext();
    const urls = Array.isArray(url) ? url : [url];

    try {
      const { audioBuffer } = await this.resolveNasaClip(urls);
      if (sequenceId !== undefined && !this.isMoonAudioSequenceCurrent(sequenceId)) {
        return 0;
      }

      // Play NASA audio — no extra filter, the original already has the radio quality
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      const gainNode = ctx.createGain();
      gainNode.gain.value = volume;
      source.connect(gainNode);
      gainNode.connect(ctx.destination);
      source.start();

      // Overlay radio static noise
      const noiseDuration = audioBuffer.duration + 1;
      const sampleRate = ctx.sampleRate;
      const noiseBuffer = ctx.createBuffer(1, sampleRate * noiseDuration, sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i++) {
        noiseData[i] = (Math.random() * 2 - 1) * 0.12;
      }
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      const noiseBandpass = ctx.createBiquadFilter();
      noiseBandpass.type = 'bandpass';
      noiseBandpass.frequency.value = 2000;
      noiseBandpass.Q.value = 0.7;
      const noiseGain = ctx.createGain();
      noiseGain.gain.value = volume * 0.15;
      noiseSource.connect(noiseBandpass);
      noiseBandpass.connect(noiseGain);
      noiseGain.connect(ctx.destination);
      noiseSource.start();
      noiseSource.stop(ctx.currentTime + noiseDuration);
      noiseGain.gain.setValueAtTime(volume * 0.15, ctx.currentTime + noiseDuration - 0.8);
      noiseGain.gain.linearRampToValueAtTime(0, ctx.currentTime + noiseDuration);
      return audioBuffer.duration;
    } catch (e) {
      console.warn('NASA audio clip failed to load', e);
      return 0;
    }
  }

  private async resolveNasaClip(urls: string[]): Promise<{ audioBuffer: AudioBuffer; sourceUrl: string }> {
    let lastError: unknown;

    for (const candidateUrl of urls) {
      try {
        const audioBuffer = await this.getCachedNasaClipBuffer(candidateUrl);
        return { audioBuffer, sourceUrl: candidateUrl };
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error('No NASA audio sources could be decoded');
  }

  private getCachedNasaClipBuffer(url: string): Promise<AudioBuffer> {
    const cached = this.nasaClipBufferCache.get(url);
    if (cached) {
      return cached;
    }

    const request = this.fetchNasaClipBuffer(url).catch((error) => {
      this.nasaClipBufferCache.delete(url);
      throw error;
    });
    this.nasaClipBufferCache.set(url, request);
    return request;
  }

  private async fetchNasaClipBuffer(url: string): Promise<AudioBuffer> {
    const ctx = this.getOrCreateAudioContext();
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} for ${url}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  /** Procedural rocket launch rumble using Web Audio API */
  private playRocketRumble(durationSec: number) {
    if (!this.isBrowser) return;
    const ctx = this.getOrCreateAudioContext();

    // Low-frequency rumble from filtered noise
    const sampleRate = ctx.sampleRate;
    const buf = ctx.createBuffer(1, sampleRate * durationSec, sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1);
    }
    const source = ctx.createBufferSource();
    source.buffer = buf;

    // Low-pass filter for deep rumble
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 120;
    lowpass.Q.value = 1.5;

    // Volume envelope: ramp up, sustain, fade out
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 2);
    gain.gain.setValueAtTime(0.25, ctx.currentTime + durationSec - 4);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);

    // Add a mid-frequency crackle layer
    const midBuf = ctx.createBuffer(1, sampleRate * durationSec, sampleRate);
    const midData = midBuf.getChannelData(0);
    for (let i = 0; i < midData.length; i++) {
      midData[i] = (Math.random() * 2 - 1) * (Math.random() > 0.7 ? 1 : 0.3);
    }
    const midSource = ctx.createBufferSource();
    midSource.buffer = midBuf;
    const midFilter = ctx.createBiquadFilter();
    midFilter.type = 'bandpass';
    midFilter.frequency.value = 400;
    midFilter.Q.value = 2;
    const midGain = ctx.createGain();
    midGain.gain.setValueAtTime(0, ctx.currentTime);
    midGain.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 1.5);
    midGain.gain.setValueAtTime(0.1, ctx.currentTime + durationSec - 4);
    midGain.gain.linearRampToValueAtTime(0, ctx.currentTime + durationSec);

    source.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + durationSec);

    midSource.connect(midFilter);
    midFilter.connect(midGain);
    midGain.connect(ctx.destination);
    midSource.start();
    midSource.stop(ctx.currentTime + durationSec);
  }

  private getOrCreateAudioContext(): AudioContext {
    this.audioCtx ??= new AudioContext();
    return this.audioCtx;
  }

  private meteorEdgeX(W: number) { return Math.random() > 0.5 ? -20 : W + 20; }
  private meteorSideAngle() { return Math.random() > 0.5 ? Math.PI / 6 : Math.PI * 5 / 6; }

  /** Spectacular space-themed celebration: shooting stars, nova bursts, sparkling stars */
  private fireSpaceCelebration(type: CelebrationType) {
    const canvas = this.celebrationCanvas?.nativeElement;
    if (!canvas) return;

    this.celebrationActive.set(true);
    this.setCelebrationCanvasSize(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const isFinale = type === 'finale';

    const colors = ['#ffe81f', '#88bbff', '#ff6644', '#4ade80', '#c084fc', '#38bdf8', '#fbbf24', '#f472b6'];
    const pick = () => colors[Math.floor(Math.random() * colors.length)];

    const stars = this.createCelebrationStars(W, H, isFinale, pick);
    const meteors: CelebrationMeteor[] = [];
    const novas: CelebrationNova[] = [];
    const sparks: CelebrationSpark[] = [];

    // Spawn meteors in waves
    const spawnMeteor = () => {
      const fromTop = Math.random() > 0.3;
      const x = fromTop ? Math.random() * W : this.meteorEdgeX(W);
      const y = fromTop ? -20 : Math.random() * H * 0.4;
      const angle = fromTop ? (Math.PI / 4 + Math.random() * Math.PI / 4) : this.meteorSideAngle();
      const speed = 6 + Math.random() * 8;
      meteors.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, len: 40 + Math.random() * 80, alpha: 1, decay: 0.008 + Math.random() * 0.005, color: pick(), trail: [] });
    };

    // Spawn novas (expanding ring flashes)
    const spawnNova = (cx?: number, cy?: number) => {
      novas.push({ x: cx ?? Math.random() * W, y: cy ?? Math.random() * H, r: 0, maxR: 60 + Math.random() * (isFinale ? 120 : 60), alpha: 1, color: pick(), ring: 0 });
    };

    // Spawn sparks radiating from a point
    const spawnSparks = (cx: number, cy: number, count: number) => {
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 1 + Math.random() * 4;
        sparks.push({ x: cx, y: cy, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, alpha: 1, decay: 0.015 + Math.random() * 0.02, size: Math.random() * 2.5 + 0.5, color: pick() });
      }
    };

    this.scheduleCelebrationBursts(isFinale, W, H, spawnMeteor, spawnNova, spawnSparks);

    let frame = 0;
    const maxFrames = isFinale ? 300 : 180; // ~5s or ~3s at 60fps

    const renderFrame = () => {
      frame++;
      this.renderCelebrationFrame(ctx, {
        width: W,
        height: H,
        frame,
        maxFrames,
        stars,
        meteors,
        novas,
        sparks,
      });

      if (frame < maxFrames) {
        this.celebrationAnimId = requestAnimationFrame(renderFrame);
      } else {
        this.finishCelebration(ctx, W, H);
      }
    };

    // Cancel any running celebration
    if (this.celebrationAnimId) cancelAnimationFrame(this.celebrationAnimId);
    this.celebrationAnimId = requestAnimationFrame(renderFrame);
  }

  private setCelebrationCanvasSize(canvas: HTMLCanvasElement) {
    canvas.width = globalThis.innerWidth;
    canvas.height = globalThis.innerHeight;
  }

  private createCelebrationStars(width: number, height: number, isFinale: boolean, pickColor: () => string): CelebrationStar[] {
    const stars: CelebrationStar[] = [];
    const starCount = isFinale ? 120 : 50;

    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * width,
        y: Math.random() * height,
        r: Math.random() * 2.5 + 0.5,
        alpha: 0,
        decay: 0.003 + Math.random() * 0.006,
        color: pickColor(),
        pulse: Math.random() * Math.PI * 2
      });
    }

    return stars;
  }

  private scheduleCelebrationBursts(
    isFinale: boolean,
    width: number,
    height: number,
    spawnMeteor: () => void,
    spawnNova: (x?: number, y?: number) => void,
    spawnSparks: (x: number, y: number, count: number) => void,
  ) {
    const meteorCount = isFinale ? 30 : 10;
    for (let i = 0; i < meteorCount; i++) {
      setTimeout(spawnMeteor, i * (isFinale ? 80 : 150) + Math.random() * 200);
    }

    const novaCount = isFinale ? 8 : 3;
    for (let i = 0; i < novaCount; i++) {
      setTimeout(() => {
        const nx = Math.random() * width;
        const ny = Math.random() * height;
        spawnNova(nx, ny);
        spawnSparks(nx, ny, isFinale ? 30 : 12);
      }, 200 + i * (isFinale ? 300 : 500));
    }

    if (!isFinale) {
      return;
    }

    setTimeout(() => {
      spawnNova(width / 2, height / 2);
      spawnSparks(width / 2, height / 2, 60);
    }, 800);

    for (let i = 0; i < 20; i++) {
      setTimeout(spawnMeteor, 1500 + i * 60);
    }
  }

  private renderCelebrationFrame(
    ctx: CanvasRenderingContext2D,
    state: CelebrationFrameState,
  ) {
    ctx.clearRect(0, 0, state.width, state.height);
    this.renderCelebrationStars(ctx, state.frame, state.maxFrames, state.stars);
    this.renderCelebrationMeteors(ctx, state.width, state.height, state.meteors);
    this.renderCelebrationNovas(ctx, state.novas);
    this.renderCelebrationSparks(ctx, state.sparks);
    ctx.globalAlpha = 1;
  }

  private renderCelebrationStars(
    ctx: CanvasRenderingContext2D,
    frame: number,
    maxFrames: number,
    stars: CelebrationStar[],
  ) {
    for (const star of stars) {
      if (star.alpha < 1 && frame < maxFrames * 0.6) {
        star.alpha = Math.min(1, star.alpha + 0.03);
      }
      if (frame > maxFrames * 0.7) {
        star.alpha = Math.max(0, star.alpha - 0.02);
      }

      const twinkle = 0.5 + 0.5 * Math.sin(frame * 0.08 + star.pulse);
      ctx.globalAlpha = star.alpha * twinkle;

      const gradient = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, star.r * 4);
      gradient.addColorStop(0, star.color);
      gradient.addColorStop(0.3, `${star.color}88`);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderCelebrationMeteors(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    meteors: CelebrationMeteor[],
  ) {
    for (let i = meteors.length - 1; i >= 0; i--) {
      const meteor = meteors[i];
      meteor.trail.push({ x: meteor.x, y: meteor.y });
      if (meteor.trail.length > 20) {
        meteor.trail.shift();
      }

      meteor.x += meteor.vx;
      meteor.y += meteor.vy;

      for (let trailIndex = 0; trailIndex < meteor.trail.length; trailIndex++) {
        const frac = trailIndex / meteor.trail.length;
        ctx.globalAlpha = meteor.alpha * frac * 0.6;
        ctx.fillStyle = meteor.color;
        ctx.beginPath();
        ctx.arc(meteor.trail[trailIndex].x, meteor.trail[trailIndex].y, 1 + frac * 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = meteor.alpha;
      const headGradient = ctx.createRadialGradient(meteor.x, meteor.y, 0, meteor.x, meteor.y, 8);
      headGradient.addColorStop(0, '#fff');
      headGradient.addColorStop(0.3, meteor.color);
      headGradient.addColorStop(1, 'transparent');
      ctx.fillStyle = headGradient;
      ctx.beginPath();
      ctx.arc(meteor.x, meteor.y, 8, 0, Math.PI * 2);
      ctx.fill();

      if (meteor.x < -50 || meteor.x > width + 50 || meteor.y > height + 50) {
        meteors.splice(i, 1);
        continue;
      }

      meteor.alpha -= meteor.decay;
      if (meteor.alpha <= 0) {
        meteors.splice(i, 1);
      }
    }
  }

  private renderCelebrationNovas(ctx: CanvasRenderingContext2D, novas: CelebrationNova[]) {
    for (let i = novas.length - 1; i >= 0; i--) {
      const nova = novas[i];
      nova.r += (nova.maxR - nova.r) * 0.08;
      nova.alpha *= 0.96;
      nova.ring += 2;

      ctx.globalAlpha = nova.alpha * 0.6;
      ctx.strokeStyle = nova.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(nova.x, nova.y, nova.r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = nova.alpha * 0.15;
      const gradient = ctx.createRadialGradient(nova.x, nova.y, 0, nova.x, nova.y, nova.r);
      gradient.addColorStop(0, nova.color);
      gradient.addColorStop(1, 'transparent');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(nova.x, nova.y, nova.r, 0, Math.PI * 2);
      ctx.fill();

      if (nova.alpha < 0.02) {
        novas.splice(i, 1);
      }
    }
  }

  private renderCelebrationSparks(ctx: CanvasRenderingContext2D, sparks: CelebrationSpark[]) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vx *= 0.98;
      spark.vy *= 0.98;
      spark.alpha -= spark.decay;
      if (spark.alpha <= 0) {
        sparks.splice(i, 1);
        continue;
      }

      ctx.globalAlpha = spark.alpha;
      ctx.fillStyle = spark.color;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = spark.alpha * 0.3;
      ctx.beginPath();
      ctx.arc(spark.x, spark.y, spark.size * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private finishCelebration(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.clearRect(0, 0, width, height);
    this.celebrationActive.set(false);
    this.celebrationAnimId = null;
  }
}
