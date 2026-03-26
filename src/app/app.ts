import { ChangeDetectionStrategy, Component, HostListener, signal, computed, effect, ViewChild, ElementRef, AfterViewInit, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { Background3DComponent } from './background-3d.component';
import { SLIDES } from './slides.data';
import { animate, stagger, cubicBezier } from 'motion';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'app-root',
  imports: [Background3DComponent, MatIconModule],
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
      (loaded)="onSceneLoaded()"
      (distanceKm)="onDistanceUpdate($event)"
      class="transition-opacity duration-[2000ms] ease-in-out"
      [class.opacity-0]="videoRevealed()">
    </app-background-3d>

    <div class="relative z-10 w-full h-screen overflow-hidden flex flex-col items-center justify-center pointer-events-none">
      
      <!-- Star Wars Crawl for Title Slide -->
      @if (currentSlide().isTitleSlide) {
        <div class="absolute inset-0 flex items-center justify-center perspective-[800px]">
          <div #crawlContainer class="w-[80%] max-w-3xl text-center text-[var(--color-starwars-yellow)] font-starwars transform-gpu rotate-x-[20deg] origin-bottom">
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
                <div class="mt-12 flex flex-col items-center gap-4">
                  <div class="w-28 h-28 rounded-full bg-white/5 border-2 border-white/20 flex items-center justify-center">
                    <div class="w-10 h-10 border-3 border-[var(--color-starwars-yellow)]/40 border-t-[var(--color-starwars-yellow)] rounded-full animate-spin"></div>
                  </div>
                  <span class="text-xl opacity-50">Laden...</span>
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

        <div #slideContainer class="relative w-full h-full pointer-events-auto">

          <!-- Floating title — top-left -->
          <div class="absolute top-10 left-10 md:left-14 z-10">
            <div class="accent-line w-16 h-[2px] bg-gradient-to-r from-[var(--color-starwars-yellow)] to-transparent mb-3 rounded-full shadow-[0_0_12px_rgba(255,232,31,0.4)] origin-left"></div>
            <h2 class="slide-title text-2xl md:text-4xl font-starwars text-[var(--color-starwars-yellow)] uppercase tracking-wider drop-shadow-[0_0_20px_rgba(255,232,31,0.3)]">
              {{ currentSlide().title }}
            </h2>
          </div>

          <!-- ═══ H1: COMPOSITION — floating data around the planet ═══ -->
          @if (currentSlide().id === 'h1') {
            <div class="absolute inset-0 pointer-events-none">
              <div class="slide-item absolute top-[14%] right-[16%] text-right">
                <div class="text-[11px] font-mono text-cyan-400/60 tracking-[0.3em] mb-1">CLASSIFICATIE</div>
                <div class="text-3xl md:text-5xl font-starwars text-cyan-300/90 drop-shadow-[0_0_30px_rgba(100,210,255,0.4)]">GASREUS</div>
                <div class="text-xs text-white/50 mt-1">Geen steen of zand zoals de aarde</div>
              </div>
              <div class="slide-item absolute top-[38%] right-[6%] md:right-[10%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-5xl md:text-7xl font-starwars text-[var(--color-starwars-yellow)] drop-shadow-[0_0_30px_rgba(255,232,31,0.4)] tabular-nums">90</span>
                  <span class="text-xl text-[var(--color-starwars-yellow)]/60 font-starwars">%</span>
                </div>
                <div class="text-xs text-white/55 tracking-wider">WATERSTOF (H₂)</div>
              </div>
              <div class="slide-item absolute top-[55%] right-[18%] md:right-[22%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-3xl md:text-5xl font-starwars text-orange-300/80 drop-shadow-[0_0_20px_rgba(255,180,100,0.3)] tabular-nums">10</span>
                  <span class="text-lg text-orange-300/50 font-starwars">%</span>
                </div>
                <div class="text-xs text-white/50 tracking-wider">HELIUM (He)</div>
              </div>
              <div class="slide-item absolute bottom-[28%] right-[10%] md:right-[14%]">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-px bg-gradient-to-r from-transparent to-cyan-400/40"></div>
                  <div>
                    <div class="flex items-baseline gap-1">
                      <span class="text-2xl md:text-3xl font-starwars text-cyan-200/75 tabular-nums">1000</span>
                      <span class="text-[11px] text-cyan-200/45 tracking-wider">KM</span>
                    </div>
                    <div class="text-[11px] text-white/40 tracking-wider">DAMPKRING DIKTE</div>
                  </div>
                </div>
              </div>
              <div class="slide-item absolute bottom-[16%] right-[22%]">
                <div class="text-xs text-red-300/60 italic flex items-center gap-2">
                  <div class="w-1 h-1 rounded-full bg-red-400/50"></div>
                  Geen vaste grond om op te landen
                </div>
              </div>
            </div>

          <!-- ═══ H5: SIZE / GRAVITY — floating comparison stats ═══ -->
          } @else if (currentSlide().id === 'h5') {
            <div class="absolute inset-0 pointer-events-none">
              <div class="slide-item absolute top-[12%] right-[14%] text-right">
                <div class="text-[11px] font-mono text-purple-400/60 tracking-[0.3em] mb-1">MASSA</div>
                <div class="flex items-baseline gap-1 justify-end">
                  <span class="text-4xl md:text-6xl font-starwars text-purple-300/90 drop-shadow-[0_0_25px_rgba(180,130,255,0.4)] tabular-nums">300</span>
                  <span class="text-lg text-purple-300/60 font-starwars">×</span>
                </div>
                <div class="text-xs text-white/50">zwaarder dan de aarde</div>
              </div>
              <div class="slide-item absolute top-[35%] right-[6%] md:right-[8%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-3xl md:text-4xl font-starwars text-[var(--color-starwars-yellow)] drop-shadow-[0_0_20px_rgba(255,232,31,0.3)] tabular-nums">9u 55m</span>
                </div>
                <div class="text-xs text-white/50 tracking-wider">ÉÉN DAG OP JUPITER</div>
              </div>
              <div class="slide-item absolute top-[52%] right-[16%] md:right-[20%]">
                <div class="flex items-baseline gap-1">
                  <span class="text-4xl md:text-5xl font-starwars text-orange-300/85 drop-shadow-[0_0_20px_rgba(255,180,100,0.3)] tabular-nums">2.5</span>
                  <span class="text-lg text-orange-300/55 font-starwars">×</span>
                </div>
                <div class="text-xs text-white/50 tracking-wider">ZWAARTEKRACHT</div>
                <div class="text-[11px] text-white/40 mt-0.5">Je weegt er flink meer!</div>
              </div>
              <div class="slide-item absolute bottom-[25%] right-[12%]">
                <div class="text-xs text-cyan-300/55 flex items-center gap-2">
                  <div class="w-8 h-px bg-gradient-to-r from-transparent to-cyan-400/35"></div>
                  Allergrootste planeet — een gasreus
                </div>
              </div>
            </div>
            @if (currentSlide().experiment) {
              <div class="absolute bottom-24 left-10 md:left-14 max-w-[32%] slide-item">
                <div class="pl-4 border-l-2 border-green-500/30">
                  <h3 class="text-base font-starwars text-green-400/80 mb-2 flex items-center gap-2">
                    <mat-icon class="!text-sm">science</mat-icon> {{ currentSlide().experiment?.title }}
                  </h3>
                  <p class="text-green-200/60 mb-2 text-xs">{{ currentSlide().experiment?.description }}</p>
                  <ul class="space-y-1 text-green-100/65 text-xs">
                    @for (instruction of currentSlide().experiment?.instructions; track $index) {
                      <li class="flex items-start gap-1.5">
                        <span class="text-green-500/55 mt-0.5 text-[10px]">▶</span>
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
                <div class="text-[11px] font-mono text-blue-400/60 tracking-[0.3em] mb-1">MAANSYSTEEM</div>
                <div class="flex items-baseline gap-1 justify-end">
                  <span class="text-5xl md:text-7xl font-starwars text-blue-300/90 drop-shadow-[0_0_30px_rgba(100,150,255,0.4)] tabular-nums">95</span>
                </div>
                <div class="text-xs text-white/50">manen in een baan om Jupiter</div>
              </div>
              <div class="slide-item absolute top-[38%] right-[6%] md:right-[8%]">
                <div class="text-lg font-starwars text-cyan-200/80 drop-shadow-[0_0_15px_rgba(100,210,255,0.3)]">EUROPA</div>
                <div class="text-xs text-white/50 mt-0.5 max-w-[180px]">Oceaan onder het ijs — misschien leven?</div>
              </div>
              <div class="slide-item absolute top-[56%] right-[18%] md:right-[22%]">
                <div class="text-lg font-starwars text-yellow-300/80 drop-shadow-[0_0_15px_rgba(255,200,50,0.3)]">IO</div>
                <div class="text-xs text-white/50 mt-0.5 max-w-[170px]">Vulkanen door Jupiters zwaartekracht</div>
              </div>
              <div class="slide-item absolute bottom-[22%] right-[14%]">
                <div class="text-xs text-red-300/55 italic flex items-center gap-2">
                  <div class="w-1 h-1 rounded-full bg-red-400/50"></div>
                  Extreme druk, wind en geen grond
                </div>
              </div>
            </div>

          <!-- ═══ QUIZ — interactive layout ═══ -->
          } @else if (currentSlide().quiz) {
            @let quiz = currentSlide().quiz!;
            <div class="absolute top-28 left-10 md:left-14 bottom-24 max-w-[42%] overflow-y-auto">
              @if (currentQuizQuestionIndex() < quiz.length) {
                @let q = quiz[currentQuizQuestionIndex()];
                <div class="slide-item">
                  <span class="text-blue-400/60 font-starwars text-sm tracking-widest mb-3 block">Vraag {{ currentQuizQuestionIndex() + 1 }} / {{ quiz.length }}</span>
                  <p class="text-xl md:text-2xl text-white/90 font-medium mb-6 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">{{ q.question }}</p>
                  <div class="grid grid-cols-1 gap-2 mb-6">
                    @for (option of q.options; track $index) {
                      <div (click)="!isAnswerRevealed() && selectQuizOption($index)"
                           class="quiz-option px-4 py-3 rounded-lg transition-all duration-300 flex items-center text-base md:text-lg font-semibold backdrop-blur-sm"
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
                      <p class="text-green-200/70 text-sm">{{ q.explanation }}</p>
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
            <div class="absolute bottom-24 left-10 md:left-14 max-w-[35%]">
              <div class="space-y-1.5">
                @for (line of currentSlide().content; track $index) {
                  <p class="slide-item text-xs text-white/50 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">{{ line }}</p>
                }
              </div>
            </div>

          <!-- ═══ DEFAULT: subtle content bottom-left ═══ -->
          } @else {
            <div class="absolute bottom-28 left-10 md:left-14 max-w-[35%] flex flex-col gap-6">
              <div class="space-y-2.5">
                @for (line of currentSlide().content; track $index) {
                  <p class="slide-item text-sm md:text-base text-white/80 drop-shadow-[0_2px_8px_rgba(0,0,0,1)]">{{ line }}</p>
                }
              </div>
              @if (currentSlide().experiment) {
                <div class="slide-item pl-4 border-l-2 border-green-500/30">
                  <h3 class="text-base font-starwars text-green-400/80 mb-2 flex items-center gap-2">
                    <mat-icon class="!text-sm">science</mat-icon> {{ currentSlide().experiment?.title }}
                  </h3>
                  <p class="text-green-200/60 mb-2 text-xs">{{ currentSlide().experiment?.description }}</p>
                  <ul class="space-y-1 text-green-100/65 text-xs">
                    @for (instruction of currentSlide().experiment?.instructions; track $index) {
                      <li class="flex items-start gap-1.5">
                        <span class="text-green-500/55 mt-0.5 text-[10px]">▶</span>
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
              <div class="text-[11px] text-[var(--color-starwars-yellow)]/55 font-starwars tracking-[0.3em] mb-1">HUIDIGE AFSTAND</div>
              <div class="flex items-baseline gap-1 justify-end">
                <span class="text-4xl md:text-6xl font-starwars text-[var(--color-starwars-yellow)] tracking-wider tabular-nums drop-shadow-[0_0_20px_rgba(255,232,31,0.4)]">{{ currentDistance() }}</span>
                <span class="text-xs text-[var(--color-starwars-yellow)]/50 font-starwars tracking-wider">M KM</span>
              </div>
              <div class="mt-1 text-[11px] text-[var(--color-starwars-yellow)]/45 font-mono tracking-wider">
                ☀️ Licht: {{ lightTravelMinutes() }} min
              </div>
            </div>
          }

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
      <div class="absolute bottom-8 left-0 right-0 flex items-center justify-between px-12 pointer-events-auto">
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
  styles: [`
    :host {
      perspective: 1200px;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes shimmer {
      0%, 100% { text-shadow: 0 0 20px rgba(255, 232, 31, 0.3), 0 0 40px rgba(255, 232, 31, 0.1); }
      50% { text-shadow: 0 0 40px rgba(255, 232, 31, 0.6), 0 0 80px rgba(255, 232, 31, 0.3), 0 0 120px rgba(255, 232, 31, 0.1); }
    }
    .title-shimmer {
      animation: shimmer 3s ease-in-out infinite;
    }
    @keyframes starBirth {
      0% {
        opacity: 0;
        transform: scale(0) rotate(-20deg);
        text-shadow: none;
        filter: blur(20px);
      }
      12% {
        opacity: 1;
        transform: scale(3) rotate(8deg);
        text-shadow: 0 0 80px #fff, 0 0 160px rgba(255, 232, 31, 0.9), 0 0 300px rgba(100, 150, 255, 0.6);
        filter: blur(3px);
        color: white;
      }
      30% {
        transform: scale(0.85) rotate(-3deg);
        text-shadow: 0 0 50px rgba(255, 232, 31, 0.8), 0 0 100px rgba(255, 232, 31, 0.4);
        filter: blur(0px);
      }
      50% {
        transform: scale(1.08) rotate(1deg);
      }
      70% {
        transform: scale(0.97) rotate(0deg);
      }
      100% {
        opacity: 1;
        transform: scale(1) rotate(0deg);
        text-shadow: 0 0 15px rgba(255, 232, 31, 0.5), 0 0 50px rgba(255, 232, 31, 0.2), 0 0 100px rgba(100, 150, 255, 0.08);
        filter: blur(0px);
      }
    }
    .name-char {
      opacity: 0;
      animation: starBirth 2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      will-change: transform, opacity, filter;
    }
    .name-char::after {
      content: '✦';
      position: absolute;
      top: -0.2em;
      right: -0.05em;
      font-size: 0.15em;
      opacity: 0;
      animation: sparkleOut 2.5s ease-out forwards;
      animation-delay: inherit;
      pointer-events: none;
    }
    @keyframes sparkleOut {
      0% { opacity: 0; transform: scale(0); }
      12% { opacity: 1; transform: scale(3); color: white; }
      30% { opacity: 0.8; transform: scale(1.5); color: #ffe81f; }
      100% { opacity: 0; transform: scale(0) translateY(-30px); }
    }
    .name-backdrop::before {
      content: '';
      position: absolute;
      inset: -80px -100px;
      background: radial-gradient(ellipse at center, rgba(255, 232, 31, 0.07) 0%, rgba(100, 150, 255, 0.04) 35%, transparent 70%);
      border-radius: 50%;
      animation: nameGlow 5s ease-in-out 2.5s infinite;
      pointer-events: none;
    }
    @keyframes nameGlow {
      0%, 100% { opacity: 0.5; transform: scale(1); }
      50% { opacity: 1; transform: scale(1.2); }
    }
    .name-subtitle {
      animation: fadeIn 1s ease-out 1.8s forwards;
      opacity: 0;
    }
    @keyframes playPulse {
      0%, 100% { box-shadow: 0 0 40px rgba(255, 232, 31, 0.3); }
      50% { box-shadow: 0 0 60px rgba(255, 232, 31, 0.6), 0 0 100px rgba(255, 232, 31, 0.2); }
    }
    .play-pulse {
      animation: playPulse 2s ease-in-out infinite;
    }
    @keyframes trophyBounce {
      0%, 100% { transform: translateY(0) rotate(0deg); }
      25% { transform: translateY(-8px) rotate(-5deg); }
      75% { transform: translateY(-4px) rotate(5deg); }
    }
    .trophy-bounce {
      animation: trophyBounce 2s ease-in-out infinite;
    }
    .animate-fade-in {
      animation: fadeIn 0.5s ease-out forwards;
    }
    @keyframes annotationFloat {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-4px); }
    }
    .annotation-layer > div {
      animation: annotationFloat 6s ease-in-out infinite;
    }
    .annotation-layer > div:nth-child(2) { animation-delay: -1s; }
    .annotation-layer > div:nth-child(3) { animation-delay: -2s; }
    .annotation-layer > div:nth-child(4) { animation-delay: -3s; }
    .annotation-layer > div:nth-child(5) { animation-delay: -4s; }
    .perspective-1000 { perspective: 1000px; }
    .transform-style-3d { transform-style: preserve-3d; }
    .backface-hidden { backface-visibility: hidden; }
    .rotate-y-180 { transform: rotateY(180deg); }
    .perspective-\\[800px\\] {
      perspective: 800px;
    }
    .rotate-x-\\[20deg\\] {
      transform: rotateX(20deg);
    }
    /* Space-overlay text readability — multi-layer dark halo behind all text */
    .slide-item,
    .slide-item * {
      text-shadow: 0 1px 4px rgba(0,0,0,0.95), 0 0 20px rgba(0,0,0,0.6), 0 4px 30px rgba(0,0,0,0.3);
    }
    .slide-title {
      text-shadow: 0 0 10px rgba(0,0,0,0.9), 0 0 30px rgba(0,0,0,0.5), 0 0 60px rgba(0,0,0,0.3);
    }
    .quiz-option,
    .quiz-option * {
      text-shadow: 0 1px 3px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5);
    }
    .quiz-complete,
    .quiz-complete * {
      text-shadow: 0 1px 4px rgba(0,0,0,0.95), 0 0 20px rgba(0,0,0,0.6);
    }
    /* Video background scrim — cinematic vignette for readability */
    .video-scrim {
      background:
        radial-gradient(ellipse at center, transparent 30%, rgba(0,0,0,0.55) 100%),
        linear-gradient(to right, rgba(0,0,0,0.5) 0%, transparent 40%, transparent 70%, rgba(0,0,0,0.3) 100%),
        linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 30%);
      animation: scrimFadeIn 1.2s ease-out forwards;
    }
    @keyframes scrimFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    /* Extra readability overlay when video plays behind text */
    .video-readability-overlay > div:first-child {
      background: linear-gradient(to right, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.35) 45%, transparent 100%) !important;
    }
  `]
})
export class App implements AfterViewInit {
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
  currentDistance = signal(0);
  celebrationActive = signal(false);
  // t = d/c: light-travel time in minutes (c = 299,792 km/s)
  lightTravelMinutes = computed(() => (this.currentDistance() * 1_000_000 / 299_792 / 60).toFixed(1));
  // 1 AU = 149,597,870.7 km
  lightTravelAU = computed(() => (this.currentDistance() * 1_000_000 / 149_597_870.7).toFixed(2));
  private videoRevealTimer: ReturnType<typeof setTimeout> | null = null;
  private bgMusicVolumeTween: ReturnType<typeof setInterval> | null = null;
  private isBrowser: boolean;
  private platformId = inject(PLATFORM_ID);

  currentSlide = computed(() => this.slides[this.currentIndex()]);
  totalSlides = computed(() => this.slides.length);

  @ViewChild('slideContainer') slideContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('crawlContainer') crawlContainer?: ElementRef<HTMLDivElement>;
  @ViewChild('bgVideo') bgVideo?: ElementRef<HTMLVideoElement>;
  @ViewChild('bgAudio') bgAudio?: ElementRef<HTMLAudioElement>;
  @ViewChild('celebrationCanvas') celebrationCanvas?: ElementRef<HTMLCanvasElement>;
  private celebrationAnimId: number | null = null;

  bgAudioSrc = 'Interstellar Main Theme - Extra Extended - Soundtrack by Hans Zimmer - Cinémavore.mp3';

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

  onSceneLoaded() {
    this.sceneLoaded.set(true);
  }

  onDistanceUpdate(km: number) {
    this.currentDistance.set(km);
  }

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
    audio.volume = 0.3;
    audio.play().catch(() => {
      // Autoplay blocked — start on first user interaction
      const resume = () => {
        audio.play().catch(() => {});
        document.removeEventListener('click', resume);
        document.removeEventListener('keydown', resume);
      };
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
    });
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

    if (this.crawlContainer?.nativeElement) {
      animate(
        this.crawlContainer.nativeElement,
        { 
          y: [dir === 1 ? '40vh' : '-40vh', '0vh'],
          opacity: [0, 1],
          rotateX: [40, 20],
          filter: ['blur(16px)', 'blur(0px)'],
          scale: [0.8, 1]
        },
        { duration: 1.2, ease: 'easeOut' }
      ).finished.then(() => this.isTransitioning.set(false));
    }

    if (this.slideContainer?.nativeElement) {
      const container = this.slideContainer.nativeElement;
      const items = container.querySelectorAll('.slide-item');
      const accentLine = container.querySelector('.accent-line');
      
      // Main container entrance
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

      // Accent line draws in from left
      if (accentLine) {
        animate(
          accentLine,
          { scaleX: [0, 1], opacity: [0, 1] },
          { duration: 0.8, delay: 0.2, ease: customEase }
        );
      }

      // Staggered items with vertical offset
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
    } else if (!this.crawlContainer?.nativeElement) {
       setTimeout(() => this.isTransitioning.set(false), 500);
    }
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
    if (this.bgMusicVolumeTween) clearInterval(this.bgMusicVolumeTween);
    this.bgMusicVolumeTween = setInterval(() => {
      const diff = target - audio.volume;
      if (Math.abs(diff) < 0.01) {
        audio.volume = target;
        clearInterval(this.bgMusicVolumeTween!);
        this.bgMusicVolumeTween = null;
      } else {
        audio.volume += diff * 0.15;
      }
    }, 50);
  }

  private meteorEdgeX(W: number) { return Math.random() > 0.5 ? -20 : W + 20; }
  private meteorSideAngle() { return Math.random() > 0.5 ? Math.PI / 6 : Math.PI * 5 / 6; }

  /** Spectacular space-themed celebration: shooting stars, nova bursts, sparkling stars */
  private fireSpaceCelebration(type: 'answer' | 'finale') {
    const canvas = this.celebrationCanvas?.nativeElement;
    if (!canvas) return;
    this.celebrationActive.set(true);
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    const isFinale = type === 'finale';

    interface Star { x: number; y: number; r: number; alpha: number; decay: number; color: string; pulse: number; }
    interface Meteor { x: number; y: number; vx: number; vy: number; len: number; alpha: number; decay: number; color: string; trail: { x: number; y: number }[]; }
    interface Nova { x: number; y: number; r: number; maxR: number; alpha: number; color: string; ring: number; }
    interface Spark { x: number; y: number; vx: number; vy: number; alpha: number; decay: number; size: number; color: string; }

    const stars: Star[] = [];
    const meteors: Meteor[] = [];
    const novas: Nova[] = [];
    const sparks: Spark[] = [];

    const colors = ['#ffe81f', '#88bbff', '#ff6644', '#4ade80', '#c084fc', '#38bdf8', '#fbbf24', '#f472b6'];
    const pick = () => colors[Math.floor(Math.random() * colors.length)];

    // Spawn initial stars
    const starCount = isFinale ? 120 : 50;
    for (let i = 0; i < starCount; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 2.5 + 0.5, alpha: 0, decay: 0.003 + Math.random() * 0.006, color: pick(), pulse: Math.random() * Math.PI * 2 });
    }

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

    // Schedule waves
    const meteorCount = isFinale ? 30 : 10;
    for (let i = 0; i < meteorCount; i++) setTimeout(spawnMeteor, i * (isFinale ? 80 : 150) + Math.random() * 200);
    const novaCount = isFinale ? 8 : 3;
    for (let i = 0; i < novaCount; i++) setTimeout(() => { const nx = Math.random() * W; const ny = Math.random() * H; spawnNova(nx, ny); spawnSparks(nx, ny, isFinale ? 30 : 12); }, 200 + i * (isFinale ? 300 : 500));
    if (isFinale) {
      // Massive center nova starburst
      setTimeout(() => { spawnNova(W / 2, H / 2); spawnSparks(W / 2, H / 2, 60); }, 800);
      // Extra meteors in second wave
      for (let i = 0; i < 20; i++) setTimeout(spawnMeteor, 1500 + i * 60);
    }

    let frame = 0;
    const maxFrames = isFinale ? 300 : 180; // ~5s or ~3s at 60fps

    const renderFrame = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);

      // Twinkling stars — fade in then hold
      for (const s of stars) {
        if (s.alpha < 1 && frame < maxFrames * 0.6) s.alpha = Math.min(1, s.alpha + 0.03);
        if (frame > maxFrames * 0.7) s.alpha = Math.max(0, s.alpha - 0.02);
        const twinkle = 0.5 + 0.5 * Math.sin(frame * 0.08 + s.pulse);
        ctx.globalAlpha = s.alpha * twinkle;
        // Draw star with glow
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 4);
        grad.addColorStop(0, s.color);
        grad.addColorStop(0.3, s.color + '88');
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 4, 0, Math.PI * 2);
        ctx.fill();
        // Core
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // Meteors with trails
      for (let i = meteors.length - 1; i >= 0; i--) {
        const m = meteors[i];
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > 20) m.trail.shift();
        m.x += m.vx;
        m.y += m.vy;
        // Draw trail
        for (let t = 0; t < m.trail.length; t++) {
          const frac = t / m.trail.length;
          ctx.globalAlpha = m.alpha * frac * 0.6;
          ctx.fillStyle = m.color;
          ctx.beginPath();
          ctx.arc(m.trail[t].x, m.trail[t].y, (1 + frac * 2), 0, Math.PI * 2);
          ctx.fill();
        }
        // Head glow
        ctx.globalAlpha = m.alpha;
        const headGrad = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, 8);
        headGrad.addColorStop(0, '#fff');
        headGrad.addColorStop(0.3, m.color);
        headGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = headGrad;
        ctx.beginPath();
        ctx.arc(m.x, m.y, 8, 0, Math.PI * 2);
        ctx.fill();
        // Fade and remove
        if (m.x < -50 || m.x > W + 50 || m.y > H + 50) { meteors.splice(i, 1); continue; }
        m.alpha -= m.decay;
        if (m.alpha <= 0) meteors.splice(i, 1);
      }

      // Nova bursts — expanding rings of light
      for (let i = novas.length - 1; i >= 0; i--) {
        const n = novas[i];
        n.r += (n.maxR - n.r) * 0.08;
        n.alpha *= 0.96;
        n.ring += 2;
        // Outer ring
        ctx.globalAlpha = n.alpha * 0.6;
        ctx.strokeStyle = n.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.stroke();
        // Inner glow fill
        ctx.globalAlpha = n.alpha * 0.15;
        const novaGrad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
        novaGrad.addColorStop(0, n.color);
        novaGrad.addColorStop(1, 'transparent');
        ctx.fillStyle = novaGrad;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
        if (n.alpha < 0.02) novas.splice(i, 1);
      }

      // Sparks
      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i];
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vx *= 0.98;
        sp.vy *= 0.98;
        sp.alpha -= sp.decay;
        if (sp.alpha <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = sp.alpha;
        ctx.fillStyle = sp.color;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size, 0, Math.PI * 2);
        ctx.fill();
        // Tiny glow
        ctx.globalAlpha = sp.alpha * 0.3;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.size * 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;

      if (frame < maxFrames) {
        this.celebrationAnimId = requestAnimationFrame(renderFrame);
      } else {
        ctx.clearRect(0, 0, W, H);
        this.celebrationActive.set(false);
        this.celebrationAnimId = null;
      }
    };

    // Cancel any running celebration
    if (this.celebrationAnimId) cancelAnimationFrame(this.celebrationAnimId);
    this.celebrationAnimId = requestAnimationFrame(renderFrame);
  }
}
